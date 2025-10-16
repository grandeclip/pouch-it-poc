import { API_CONFIG } from "@/constants/config";
import * as BackgroundFetch from "expo-background-fetch";
import * as FileSystem from "expo-file-system/legacy";
import * as ImageManipulator from "expo-image-manipulator";
import * as MediaLibrary from "expo-media-library";
import * as TaskManager from "expo-task-manager";
import { markAsFailed, markAsUploaded, saveUploadStatus } from "./uploadDB";
import { clearProgress, saveProgress } from "./uploadQueue";

export const UNIFIED_UPLOAD_TASK = "UNIFIED_UPLOAD_TASK";

/**
 * 업로드 배치 크기 (포그라운드/백그라운드 공통)
 */
const BATCH_SIZE = 20;

/**
 * 단일 파일 업로드 (fetch 사용)
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

    const uploadStart = Date.now();
    const uploadTask = FileSystem.createUploadTask(
      uploadUrl,
      compressedImage.uri,
      uploadOptions
    );

    const res = await uploadTask.uploadAsync();
    const uploadTime = Date.now() - uploadStart;

    const totalTime = Date.now() - fileStartTime;
    console.log(
      `[타이밍] ${file.filename}: URI 변환 ${uriConvertTime}ms | 압축 ${compressTime}ms | 업로드 ${uploadTime}ms | 총 ${totalTime}ms`
    );

    if (!res) {
      return {
        success: false,
        error: "업로드 응답 없음",
      };
    }

    if (res.status >= 200 && res.status < 300) {
      return { success: true };
    } else {
      return {
        success: false,
        error: `서버 응답 오류: ${res.status} - ${res.body || "응답 없음"}`,
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
 * 파일 배치 업로드 (배치 안의 파일들을 순차적으로)
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
}> {
  const batchStartTime = Date.now();
  try {
    console.log(`[배치 ${batchIndex}] ${files.length}개 파일 순차 업로드 시작`);

    const successFiles: { id: string; uri: string; filename: string }[] = [];
    const failedFiles: {
      file: { id: string; uri: string; filename: string };
      error: string;
    }[] = [];

    // 배치 안의 파일들을 순차적으로 업로드
    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      const result = await uploadSingleFile(file, userId);
      if (result.success) {
        successFiles.push(file);
      } else {
        failedFiles.push({
          file,
          error: result.error || "알 수 없는 오류",
        });
      }
    }

    const batchTime = Date.now() - batchStartTime;
    const avgTimePerFile = batchTime / files.length;

    // 로그 출력
    if (failedFiles.length > 0) {
      console.warn(
        `⚠️ [배치 ${batchIndex}] ${failedFiles.length}개 파일 업로드 실패:`,
        failedFiles.map((f) => `\n  - ${f.file.filename}: ${f.error}`).join("")
      );
    }

    console.log(
      `✅ [배치 ${batchIndex}] 완료: ${successFiles.length}/${
        files.length
      }개 성공 | 총 ${batchTime}ms | 파일당 평균 ${avgTimePerFile.toFixed(0)}ms`
    );

    return { successFiles, failedFiles };
  } catch (error) {
    console.error(`[배치 ${batchIndex}] 예외 발생:`, error);

    // 예외 발생 시 모든 파일을 실패로 처리
    return {
      successFiles: [],
      failedFiles: files.map((file) => ({
        file,
        error: error instanceof Error ? error.message : "알 수 없는 오류",
      })),
    };
  }
}

/**
 * 실제 업로드 로직 (포그라운드/백그라운드 공통)
 * 모든 파일을 병렬로 업로드
 */
async function performUpload(
  files: { id: string; uri: string; filename: string }[]
): Promise<BackgroundFetch.BackgroundFetchResult> {
  const totalStartTime = Date.now();
  console.log(`\n${"=".repeat(60)}`);
  console.log(`[UnifiedUpload] 업로드 시작: ${files.length}개 파일`);
  console.log(`${"=".repeat(60)}\n`);

  try {
    // 1. 미디어 라이브러리 권한 확인
    const { status } = await MediaLibrary.getPermissionsAsync();
    if (status !== "granted") {
      console.log("[UnifiedUpload] 미디어 라이브러리 권한 없음");
      return BackgroundFetch.BackgroundFetchResult.Failed;
    }

    if (files.length === 0) {
      clearProgress();
      return BackgroundFetch.BackgroundFetchResult.NoData;
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

    console.log(`\n${"=".repeat(60)}`);
    console.log(`[전체 통계]`);
    console.log(`  총 파일: ${files.length}개`);
    console.log(
      `  성공: ${successful}개 | 실패: ${failed}개 | 성공률: ${successRate}%`
    );
    console.log(
      `  총 소요 시간: ${totalTime}ms (${(totalTime / 1000).toFixed(2)}초)`
    );
    console.log(`  파일당 평균: ${avgTimePerFile.toFixed(0)}ms`);
    console.log(`  배치 수: ${batches.length}개 (병렬 실행)`);
    console.log(`${"=".repeat(60)}\n`);

    if (successful > 0) {
      return BackgroundFetch.BackgroundFetchResult.NewData;
    } else {
      return BackgroundFetch.BackgroundFetchResult.Failed;
    }
  } catch (error) {
    console.error("[UnifiedUpload] 업로드 오류:", error);
    clearProgress();
    return BackgroundFetch.BackgroundFetchResult.Failed;
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
    return BackgroundFetch.BackgroundFetchResult.NoData;
  }

  // 큐에서 파일 가져오기
  const filesToUpload = [...uploadQueue];
  console.log(`[TaskManager] ${filesToUpload.length}개 파일 업로드 시작`);

  // 병렬 업로드 실행
  const result = await performUpload(filesToUpload);

  // 성공하면 큐에서 제거
  if (result === BackgroundFetch.BackgroundFetchResult.NewData) {
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
      await BackgroundFetch.registerTaskAsync(UNIFIED_UPLOAD_TASK, {
        minimumInterval: 15 * 60, // 15분
        stopOnTerminate: false, // 앱 종료 후에도 실행
        startOnBoot: true, // 기기 재시작 후 실행 (Android)
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
      await BackgroundFetch.unregisterTaskAsync(UNIFIED_UPLOAD_TASK);
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
