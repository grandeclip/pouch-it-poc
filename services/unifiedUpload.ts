import { API_CONFIG } from "@/constants/config";
import * as BackgroundFetch from "expo-background-fetch";
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
  try {
    let uploadUri = file.uri;

    // iOS Photos URI 변환
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

    const uploadUrl = `${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.SCREENSHOTS}`;

    // FormData 생성
    const formData = new FormData();
    // @ts-ignore - React Native의 FormData는 타입 정의가 다름
    formData.append("screenshots", {
      uri: uploadUri,
      type: "image/jpeg",
      name: file.filename,
    });
    formData.append("userId", userId);

    // fetch 사용 - 백그라운드에서도 완료까지 실행됨
    const response = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "Content-Type": "multipart/form-data",
        "X-Guest-Id": userId,
      },
      body: formData,
    });

    console.log(`[uploadSingleFile] 응답 상태: ${response.status}`);

    if (response.ok) {
      console.log(`✅ 파일 업로드 성공: ${file.filename}`);
      return { success: true };
    } else {
      const responseText = await response.text();
      console.error(
        `[uploadSingleFile] 서버 오류 응답: ${response.status} - ${responseText}`
      );
      return {
        success: false,
        error: `서버 응답 오류: ${response.status} - ${responseText}`,
      };
    }
  } catch (error) {
    console.error(`❌ 파일 업로드 실패: ${file.filename}`, error);

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
  _isBackground: boolean
): Promise<{ success: boolean; error?: string }> {
  try {
    console.log(`[uploadBatch] ${files.length}개 파일 순차 업로드 시작`);

    let successCount = 0;
    let failedCount = 0;

    // 배치 안의 파일들을 순차적으로 업로드
    for (const file of files) {
      const result = await uploadSingleFile(file, userId);
      if (result.success) {
        successCount++;
      } else {
        failedCount++;
      }
    }

    if (failedCount > 0) {
      console.warn(`⚠️ ${failedCount}개 파일 업로드 실패`);
    }

    if (successCount > 0) {
      console.log(`✅ 배치 업로드 성공: ${successCount}/${files.length}개`);
      return { success: true };
    } else {
      return {
        success: false,
        error: `모든 파일 업로드 실패 (${failedCount}개)`,
      };
    }
  } catch (error) {
    console.error("배치 업로드 실패:", error);

    return {
      success: false,
      error: error instanceof Error ? error.message : "알 수 없는 오류",
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
  console.log(`[UnifiedUpload] 업로드 시작: ${files.length}개 파일`);

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
      `[UnifiedUpload] ${batches.length}개 배치를 병렬로 업로드 시작`
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
    const batchPromises = batches.map((batch) =>
      uploadBatch(batch, API_CONFIG.GUEST_USER_ID, false)
    );
    const batchResults = await Promise.allSettled(batchPromises);

    // 6. 결과 처리
    let successful = 0;
    let failed = 0;

    batchResults.forEach((result, index) => {
      const batch = batches[index];

      if (result.status === "fulfilled" && result.value.success) {
        // 성공 시
        for (const file of batch) {
          markAsUploaded(file.id);
          successful++;
        }
      } else {
        // 실패 시
        const errorMessage =
          result.status === "fulfilled"
            ? result.value.error || "배치 업로드 실패"
            : result.reason?.message || "배치 업로드 실패";

        for (const file of batch) {
          markAsFailed(file.id, errorMessage);
          failed++;
        }
      }
    });

    // 7. 진행 상황 업데이트
    saveProgress({
      current: successful,
      total: files.length,
      isUploading: false,
    });

    console.log(
      `[UnifiedUpload] 업로드 완료: 성공 ${successful}개, 실패 ${failed}개`
    );

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
