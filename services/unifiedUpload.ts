import { API_CONFIG } from "@/constants/config";
import axios from "axios";
import * as BackgroundTask from "expo-background-task";
import * as FileSystem from "expo-file-system/legacy";
import * as ImageManipulator from "expo-image-manipulator";
import * as MediaLibrary from "expo-media-library";
import * as TaskManager from "expo-task-manager";
import { markAsFailed, markAsUploaded, saveUploadStatus } from "./uploadDB";
import { clearProgress, saveProgress } from "./uploadQueue";

// ============================================================
// 🔄 HTTP 클라이언트 선택 (주석 전환으로 쉽게 ON/OFF)
// ============================================================
// ✅ true:  axios 사용 (빠른 속도, JavaScript 레벨 통신)
// ✅ false: FileSystem API 사용 (네이티브 모듈, 백그라운드 안정성)
//
// 📝 사용법:
//   1. 아래 값을 true/false로 변경
//   2. 앱 재시작
//   3. 콘솔 로그에서 [axios] 또는 [FileSystem] 확인
//
// 💡 참고:
//   - 압축, URI 변환, 배치 로직은 동일
//   - HTTP 통신 부분만 교체됨
//   - 성능 비교 테스트 시 같은 조건에서 진행 가능
// ============================================================
const USE_AXIOS = false;
// ============================================================

export const UNIFIED_UPLOAD_TASK = "UNIFIED_UPLOAD_TASK";

/**
 * 업로드 배치 크기 (포그라운드/백그라운드 공통)
 */
const BATCH_SIZE = 50;

/**
 * 압축된 파일 정보 인터페이스
 */
interface CompressedFile {
  id: string;
  filename: string;
  compressedUri: string;
  originalUri: string;
  compressTime: number;
  uriConvertTime: number;
  compressedSize: number; // 압축된 파일 크기 (바이트)
}

/**
 * 파일 압축 전용 함수 (URI 변환 + JPEG 압축)
 * - 배치 내에서 병렬 처리됨
 */
async function compressAndPrepareFile(file: {
  id: string;
  uri: string;
  filename: string;
}): Promise<
  | CompressedFile
  | { error: string; file: { id: string; uri: string; filename: string } }
> {
  try {
    let uploadUri = file.uri;

    // iOS Photos URI 변환
    const uriConvertStart = Date.now();
    if (uploadUri.startsWith("ph://") || uploadUri.startsWith("ph-upload://")) {
      try {
        const asset = await MediaLibrary.getAssetInfoAsync(file.id);
        if (asset.localUri) {
          uploadUri = asset.localUri;
        }
      } catch (error) {
        console.error(`URI 변환 실패: ${file.filename}`, error);
      }
    }
    const uriConvertTime = Date.now() - uriConvertStart;

    // 이미지 압축 (0.7 품질)
    const compressStart = Date.now();
    const compressedImage = await ImageManipulator.manipulateAsync(
      uploadUri,
      [], // 리사이즈 없이 압축만
      { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
    );
    const compressTime = Date.now() - compressStart;

    // 압축된 파일 크기 정보 가져오기
    const fileInfo = await FileSystem.getInfoAsync(compressedImage.uri);
    const compressedSize = fileInfo.exists && fileInfo.size ? fileInfo.size : 0;

    return {
      id: file.id,
      filename: file.filename,
      compressedUri: compressedImage.uri,
      originalUri: file.uri,
      compressTime,
      uriConvertTime,
      compressedSize,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "압축 실패",
      file,
    };
  }
}

/**
 * 압축된 파일 업로드 전용 함수
 * - USE_AXIOS 플래그에 따라 axios 또는 FileSystem 사용
 */
async function uploadCompressedFile(
  compressed: CompressedFile,
  userId: string
): Promise<{ success: boolean; error?: string; uploadTime: number }> {
  const uploadUrl = `${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.SCREENSHOTS}`;
  const uploadStart = Date.now();
  let uploadSuccess = false;
  let uploadError = "";

  if (USE_AXIOS) {
    // ===== axios 사용 =====
    try {
      const formData = new FormData();

      // React Native 방식으로 파일 추가
      // @ts-ignore - React Native FormData는 웹과 다른 인터페이스 사용
      formData.append("screenshots", {
        uri: compressed.compressedUri,
        type: "image/jpeg",
        name: compressed.filename,
      });

      formData.append("userId", userId);

      const response = await axios.post(uploadUrl, formData, {
        headers: {
          "X-Guest-Id": API_CONFIG.GUEST_USER_ID,
          "Content-Type": "multipart/form-data",
        },
        timeout: 30000, // 30초 타임아웃
      });

      if (response.status >= 200 && response.status < 300) {
        uploadSuccess = true;
      } else {
        uploadError = `서버 응답 오류: ${response.status}`;
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        uploadError = `axios 오류: ${error.message} (${
          error.code || "UNKNOWN"
        })`;
      } else {
        uploadError =
          error instanceof Error ? error.message : "알 수 없는 오류";
      }
    }
  } else {
    // ===== FileSystem 사용 =====
    try {
      const uploadOptions: FileSystem.FileSystemUploadOptions = {
        headers: {
          "X-Guest-Id": API_CONFIG.GUEST_USER_ID,
        },
        uploadType: FileSystem.FileSystemUploadType.MULTIPART,
        fieldName: "screenshots",
        mimeType: "image/jpeg",
        parameters: {
          userId: userId,
        },
      };

      const uploadTask = FileSystem.createUploadTask(
        uploadUrl,
        compressed.compressedUri,
        uploadOptions
      );

      const res = await uploadTask.uploadAsync();

      if (!res) {
        uploadError = "업로드 응답 없음";
      } else if (res.status >= 200 && res.status < 300) {
        uploadSuccess = true;
      } else {
        uploadError = `서버 응답 오류: ${res.status} - ${
          res.body || "응답 없음"
        }`;
      }
    } catch (error) {
      uploadError = error instanceof Error ? error.message : "알 수 없는 오류";
    }
  }

  const uploadTime = Date.now() - uploadStart;

  if (uploadSuccess) {
    return { success: true, uploadTime };
  } else {
    return {
      success: false,
      error: uploadError || "알 수 없는 오류",
      uploadTime,
    };
  }
}

/**
 * 단일 파일 업로드 (레거시 - 순차 처리용)
 * ⚠️ 현재는 uploadBatch에서 압축 병렬화를 사용하므로 이 함수는 사용되지 않음
 * fetch는 네이티브에서 백그라운드를 일부 지원
 */
async function uploadSingleFile(
  file: { id: string; uri: string; filename: string },
  userId: string
): Promise<{ success: boolean; error?: string }> {
  const fileStartTime = Date.now();
  try {
    let uploadUri = file.uri;

    // iOS Photos URI 변환
    const uriConvertStart = Date.now();
    if (uploadUri.startsWith("ph://") || uploadUri.startsWith("ph-upload://")) {
      try {
        const asset = await MediaLibrary.getAssetInfoAsync(file.id);
        if (asset.localUri) {
          uploadUri = asset.localUri;
        }
      } catch (error) {
        console.error(`URI 변환 실패: ${file.filename}`, error);
      }
    }
    const uriConvertTime = Date.now() - uriConvertStart;

    // 이미지 압축 (0.7 품질)
    const compressStart = Date.now();
    const compressedImage = await ImageManipulator.manipulateAsync(
      uploadUri,
      [], // 리사이즈 없이 압축만
      { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
    );
    const compressTime = Date.now() - compressStart;

    const uploadUrl = `${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.SCREENSHOTS}`;

    // ===== HTTP 클라이언트 선택 =====
    const uploadStart = Date.now();
    let uploadSuccess = false;
    let uploadError = "";

    if (USE_AXIOS) {
      // ===== axios 사용 =====
      try {
        const formData = new FormData();

        // React Native 방식으로 파일 추가
        // @ts-ignore - React Native FormData는 웹과 다른 인터페이스 사용
        formData.append("screenshots", {
          uri: compressedImage.uri,
          type: "image/jpeg",
          name: file.filename,
        });

        formData.append("userId", userId);

        const response = await axios.post(uploadUrl, formData, {
          headers: {
            "X-Guest-Id": API_CONFIG.GUEST_USER_ID,
            "Content-Type": "multipart/form-data",
          },
          timeout: 30000, // 30초 타임아웃
        });

        if (response.status >= 200 && response.status < 300) {
          uploadSuccess = true;
        } else {
          uploadError = `서버 응답 오류: ${response.status}`;
        }
      } catch (error) {
        if (axios.isAxiosError(error)) {
          uploadError = `axios 오류: ${error.message} (${
            error.code || "UNKNOWN"
          })`;
        } else {
          uploadError =
            error instanceof Error ? error.message : "알 수 없는 오류";
        }
      }
    } else {
      // ===== FileSystem 사용 =====
      try {
        const uploadOptions: FileSystem.FileSystemUploadOptions = {
          headers: {
            "X-Guest-Id": API_CONFIG.GUEST_USER_ID,
          },
          uploadType: FileSystem.FileSystemUploadType.MULTIPART,
          fieldName: "screenshots",
          mimeType: "image/jpeg",
          parameters: {
            userId: userId,
          },
        };

        const uploadTask = FileSystem.createUploadTask(
          uploadUrl,
          compressedImage.uri,
          uploadOptions
        );

        const res = await uploadTask.uploadAsync();

        if (!res) {
          uploadError = "업로드 응답 없음";
        } else if (res.status >= 200 && res.status < 300) {
          uploadSuccess = true;
        } else {
          uploadError = `서버 응답 오류: ${res.status} - ${
            res.body || "응답 없음"
          }`;
        }
      } catch (error) {
        uploadError =
          error instanceof Error ? error.message : "알 수 없는 오류";
      }
    }

    const uploadTime = Date.now() - uploadStart;
    const totalTime = Date.now() - fileStartTime;

    const httpClient = USE_AXIOS ? "axios" : "FileSystem";
    console.log(
      `[타이밍][${httpClient}] ${file.filename}: URI 변환 ${uriConvertTime}ms | 압축 ${compressTime}ms | 업로드 ${uploadTime}ms | 총 ${totalTime}ms`
    );

    if (uploadSuccess) {
      return { success: true };
    } else {
      return {
        success: false,
        error: uploadError || "알 수 없는 오류",
      };
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "알 수 없는 오류",
    };
  }
}

/**
 * 파일 배치 업로드 (압축 병렬 + 업로드 순차)
 * - [1단계] 배치 내 모든 파일 압축을 병렬로 수행
 * - [2단계] 압축된 파일들을 순차적으로 업로드
 */
async function uploadBatch(
  files: { id: string; uri: string; filename: string }[],
  userId: string,
  _isBackground: boolean,
  batchIndex: number
): Promise<{
  successFiles: { id: string; uri: string; filename: string }[];
  failedFiles: {
    file: { id: string; uri: string; filename: string };
    error: string;
  }[];
  successSize: number; // 성공한 파일들의 총 용량 (바이트)
}> {
  const batchStartTime = Date.now();
  const httpClient = USE_AXIOS ? "axios" : "FileSystem";

  try {
    console.log(
      `[배치 ${batchIndex}] ${files.length}개 파일 업로드 시작 (HTTP: ${httpClient})`
    );

    // ===== 1단계: 모든 파일 압축을 병렬로 수행 =====
    const compressPhaseStart = Date.now();
    console.log(
      `[배치 ${batchIndex}] 1단계: ${files.length}개 파일 병렬 압축 시작`
    );

    const compressResults = await Promise.all(
      files.map((file) => compressAndPrepareFile(file))
    );

    const compressPhaseTime = Date.now() - compressPhaseStart;

    // 압축 성공/실패 분류
    const compressedFiles: CompressedFile[] = [];
    const compressFailed: {
      file: { id: string; uri: string; filename: string };
      error: string;
    }[] = [];

    compressResults.forEach((result) => {
      if ("error" in result) {
        compressFailed.push(result);
      } else {
        compressedFiles.push(result);
      }
    });

    // 압축 단계 통계
    const totalCompressTime = compressedFiles.reduce(
      (sum, f) => sum + f.compressTime,
      0
    );
    const totalUriConvertTime = compressedFiles.reduce(
      (sum, f) => sum + f.uriConvertTime,
      0
    );
    const avgCompressTime =
      compressedFiles.length > 0
        ? totalCompressTime / compressedFiles.length
        : 0;
    const avgUriConvertTime =
      compressedFiles.length > 0
        ? totalUriConvertTime / compressedFiles.length
        : 0;

    console.log(
      `[배치 ${batchIndex}] 1단계 완료: ${compressedFiles.length}/${files.length}개 압축 성공 | ` +
        `총 ${compressPhaseTime}ms | URI 변환 평균 ${avgUriConvertTime.toFixed(
          0
        )}ms | 압축 평균 ${avgCompressTime.toFixed(0)}ms`
    );

    if (compressFailed.length > 0) {
      console.warn(
        `⚠️ [배치 ${batchIndex}] ${compressFailed.length}개 파일 압축 실패`
      );
    }

    // ===== 2단계: 압축된 파일들을 순차 업로드 =====
    const uploadPhaseStart = Date.now();
    console.log(
      `[배치 ${batchIndex}] 2단계: ${compressedFiles.length}개 파일 순차 업로드 시작`
    );

    const successFiles: { id: string; uri: string; filename: string }[] = [];
    const uploadFailed: {
      file: { id: string; uri: string; filename: string };
      error: string;
    }[] = [];

    let totalUploadTime = 0;

    for (const compressed of compressedFiles) {
      const result = await uploadCompressedFile(compressed, userId);
      totalUploadTime += result.uploadTime;

      if (result.success) {
        successFiles.push({
          id: compressed.id,
          uri: compressed.originalUri,
          filename: compressed.filename,
        });
      } else {
        uploadFailed.push({
          file: {
            id: compressed.id,
            uri: compressed.originalUri,
            filename: compressed.filename,
          },
          error: result.error || "알 수 없는 오류",
        });
      }
    }

    const uploadPhaseTime = Date.now() - uploadPhaseStart;
    const avgUploadTime =
      compressedFiles.length > 0 ? totalUploadTime / compressedFiles.length : 0;

    // 성공한 파일들의 총 용량 계산
    const successTotalSize = successFiles.reduce((sum, file) => {
      const compressed = compressedFiles.find(
        (c) => c.id === file.id
      );
      return sum + (compressed?.compressedSize || 0);
    }, 0);

    const successTotalSizeMB = (successTotalSize / 1024 / 1024).toFixed(2);

    console.log(
      `[배치 ${batchIndex}] 2단계 완료: ${successFiles.length}/${compressedFiles.length}개 업로드 성공 | ` +
        `총 ${uploadPhaseTime}ms | 업로드 평균 ${avgUploadTime.toFixed(0)}ms | ` +
        `업로드 용량: ${successTotalSizeMB}MB`
    );

    // ===== 전체 결과 정리 =====
    const allFailedFiles = [...compressFailed, ...uploadFailed];
    const batchTime = Date.now() - batchStartTime;
    const avgTimePerFile = files.length > 0 ? batchTime / files.length : 0;

    // 압축 병렬화로 절약된 시간 계산
    const savedTime = totalCompressTime - compressPhaseTime;

    if (allFailedFiles.length > 0) {
      console.warn(
        `⚠️ [배치 ${batchIndex}] ${allFailedFiles.length}개 파일 실패:`,
        allFailedFiles
          .map((f) => `\n  - ${f.file.filename}: ${f.error}`)
          .join("")
      );
    }

    console.log(
      `✅ [배치 ${batchIndex}] 전체 완료: ${successFiles.length}/${files.length}개 성공 | ` +
        `총 ${batchTime}ms | 파일당 평균 ${avgTimePerFile.toFixed(0)}ms | ` +
        `압축 병렬화로 ${savedTime.toFixed(0)}ms 절약`
    );

    return { successFiles, failedFiles: allFailedFiles, successSize: successTotalSize };

  } catch (error) {
    console.error(`[배치 ${batchIndex}] 예외 발생:`, error);

    // 예외 발생 시 모든 파일을 실패로 처리
    return {
      successFiles: [],
      failedFiles: files.map((file) => ({
        file,
        error: error instanceof Error ? error.message : "알 수 없는 오류",
      })),
      successSize: 0,
    };
  }
}

/**
 * 실제 업로드 로직 (포그라운드/백그라운드 공통)
 * 모든 파일을 병렬로 업로드
 */
async function performUpload(
  files: { id: string; uri: string; filename: string }[]
): Promise<BackgroundTask.BackgroundTaskResult> {
  const totalStartTime = Date.now();
  console.log(`\n${"=".repeat(60)}`);
  console.log(`[UnifiedUpload] 업로드 시작: ${files.length}개 파일`);
  console.log(`${"=".repeat(60)}\n`);

  try {
    // 1. 미디어 라이브러리 권한 확인
    const { status } = await MediaLibrary.getPermissionsAsync();
    if (status !== "granted") {
      console.log("[UnifiedUpload] 미디어 라이브러리 권한 없음");
      return BackgroundTask.BackgroundTaskResult.Failed;
    }

    if (files.length === 0) {
      clearProgress();
      return BackgroundTask.BackgroundTaskResult.Success;
    }

    // 2. 모든 파일을 BATCH_SIZE개씩 나눠서 배치 생성
    const batches: { id: string; uri: string; filename: string }[][] = [];
    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      batches.push(files.slice(i, i + BATCH_SIZE));
    }

    console.log(
      `[UnifiedUpload] ${batches.length}개 배치를 병렬로 업로드 시작 (배치 크기: ${BATCH_SIZE})`
    );

    // 3. 모든 파일 uploading으로 표시
    for (const file of files) {
      saveUploadStatus(file.id, {
        id: file.id,
        filename: file.filename,
        uri: file.uri,
        status: "uploading",
        retryCount: 0,
      });
    }

    // 4. 진행 상황 저장
    saveProgress({
      current: 0,
      total: files.length,
      isUploading: true,
      startTime: Date.now(),
    });

    // 5. 모든 배치를 병렬로 업로드
    const batchPromises = batches.map((batch, index) =>
      uploadBatch(batch, API_CONFIG.GUEST_USER_ID, false, index + 1)
    );
    const batchResults = await Promise.allSettled(batchPromises);

    // 6. 결과 처리
    let successful = 0;
    let failed = 0;
    let totalUploadedSize = 0; // 업로드된 파일의 총 용량

    batchResults.forEach((result) => {
      if (result.status === "fulfilled") {
        // 성공한 파일들 처리
        for (const file of result.value.successFiles) {
          markAsUploaded(file.id);
          successful++;
        }

        // 실패한 파일들 처리
        for (const failedItem of result.value.failedFiles) {
          markAsFailed(failedItem.file.id, failedItem.error);
          failed++;
        }

        // 배치의 총 업로드 용량 누적
        totalUploadedSize += result.value.successSize;
      } else {
        // Promise 자체가 reject된 경우 (예외 발생)
        console.error("[performUpload] 배치 Promise 실패:", result.reason);
        failed++;
      }
    });

    // 7. 진행 상황 업데이트
    saveProgress({
      current: successful,
      total: files.length,
      isUploading: false,
    });

    const totalTime = Date.now() - totalStartTime;
    const avgTimePerFile = totalTime / files.length;
    const successRate = ((successful / files.length) * 100).toFixed(1);
    const totalUploadedSizeMB = (totalUploadedSize / 1024 / 1024).toFixed(2);

    console.log(`\n${"=".repeat(60)}`);
    console.log(`[전체 통계]`);
    console.log(`  총 파일: ${files.length}개`);
    console.log(
      `  성공: ${successful}개 | 실패: ${failed}개 | 성공률: ${successRate}%`
    );
    console.log(`  업로드된 총 용량: ${totalUploadedSizeMB}MB`);
    console.log(
      `  총 소요 시간: ${totalTime}ms (${(totalTime / 1000).toFixed(2)}초)`
    );
    console.log(`  파일당 평균: ${avgTimePerFile.toFixed(0)}ms`);
    console.log(`  배치 수: ${batches.length}개 (병렬 실행)`);
    console.log(`${"=".repeat(60)}\n`);

    if (successful > 0) {
      return BackgroundTask.BackgroundTaskResult.Success;
    } else {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  } catch (error) {
    console.error("[UnifiedUpload] 업로드 오류:", error);
    clearProgress();
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
}

// 업로드할 파일을 저장하는 전역 변수 (TaskManager용)
let uploadQueue: { id: string; uri: string; filename: string }[] = [];

/**
 * TaskManager Task 정의
 * 이 안에서 병렬 업로드 실행
 */
TaskManager.defineTask(UNIFIED_UPLOAD_TASK, async () => {
  console.log("[TaskManager] 업로드 Task 실행");

  if (uploadQueue.length === 0) {
    console.log("[TaskManager] 업로드할 파일 없음");
    return BackgroundTask.BackgroundTaskResult.Success;
  }

  // 큐에서 파일 가져오기
  const filesToUpload = [...uploadQueue];
  console.log(`[TaskManager] ${filesToUpload.length}개 파일 업로드 시작`);

  // 병렬 업로드 실행
  const result = await performUpload(filesToUpload);

  // 성공하면 큐에서 제거
  if (result === BackgroundTask.BackgroundTaskResult.Success) {
    uploadQueue = [];
  }

  return result;
});

/**
 * 백그라운드 업로드 Task 등록 (주기적 실행)
 */
export async function registerPeriodicUpload(): Promise<void> {
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(
      UNIFIED_UPLOAD_TASK
    );

    if (!isRegistered) {
      await BackgroundTask.registerTaskAsync(UNIFIED_UPLOAD_TASK, {
        minimumInterval: 15 * 60, // 15분
      });
      console.log("[UnifiedUpload] 주기적 백그라운드 업로드 Task 등록 완료");
    } else {
      console.log("[UnifiedUpload] 주기적 백그라운드 업로드 Task 이미 등록됨");
    }
  } catch (error) {
    console.error("[UnifiedUpload] Task 등록 실패:", error);
  }
}

/**
 * 백그라운드 업로드 Task 해제
 */
export async function unregisterPeriodicUpload(): Promise<void> {
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(
      UNIFIED_UPLOAD_TASK
    );

    if (isRegistered) {
      await BackgroundTask.unregisterTaskAsync(UNIFIED_UPLOAD_TASK);
      console.log("[UnifiedUpload] 주기적 백그라운드 업로드 Task 해제 완료");
    }
  } catch (error) {
    console.error("[UnifiedUpload] Task 해제 실패:", error);
  }
}

/**
 * 파일들을 병렬 업로드
 */
export async function uploadFiles(
  files: { id: string; uri: string; filename: string }[]
): Promise<void> {
  console.log(`[uploadFiles] ${files.length}개 파일 병렬 업로드 시작`);

  // 전역 큐에 저장 (백그라운드 Task에서 사용)
  uploadQueue = [...files];

  // 포그라운드에서 즉시 병렬 업로드 실행
  // axios Promise는 이미 시작되면 백그라운드에서도 완료까지 실행됨
  await performUpload(files);

  // 성공하면 큐 비우기
  uploadQueue = [];
}
