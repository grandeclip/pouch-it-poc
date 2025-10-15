import { uploadFiles } from "./unifiedUpload";
import { getProgress } from "./uploadQueue";

export interface UploadResult {
  success: boolean;
  fileId?: string;
  error?: string;
}

/**
 * 여러 스크린샷을 병렬 배치 업로드 (TaskManager 사용)
 */
export async function uploadScreenshots(
  files: { id: string; uri: string; filename: string }[],
  _userId?: string,
  onProgress?: (current: number, total: number) => void,
  _options?: { parallel?: boolean }
): Promise<{
  successful: number;
  failed: number;
  results: UploadResult[];
  elapsedTime: number;
}> {
  const startTime = Date.now();
  console.log(`📦 TaskManager 기반 병렬 업로드 시작: ${files.length}개 파일`);

  // TaskManager 내부에서 병렬 업로드 실행
  uploadFiles(files); // 비동기로 실행

  // 진행 상황 모니터링
  let lastProgress = 0;
  const pollInterval = setInterval(() => {
    const progress = getProgress();
    if (progress && onProgress) {
      if (progress.current !== lastProgress) {
        onProgress(progress.current, progress.total);
        lastProgress = progress.current;
      }

      if (!progress.isUploading) {
        clearInterval(pollInterval);
      }
    }
  }, 500);

  // 업로드 완료 대기 (최대 10분)
  const maxWaitTime = 10 * 60 * 1000;
  const checkInterval = 1000;
  let elapsedWaitTime = 0;

  while (elapsedWaitTime < maxWaitTime) {
    const progress = getProgress();

    if (!progress || !progress.isUploading) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, checkInterval));
    elapsedWaitTime += checkInterval;
  }

  clearInterval(pollInterval);

  // 결과 계산
  const progress = getProgress();
  const successful = progress?.current || 0;
  const failed = files.length - successful;
  const elapsedTime = Date.now() - startTime;

  const results: UploadResult[] = files.map((_, index) => {
    if (index < successful) {
      return { success: true };
    }
    return { success: false, error: "업로드 실패" };
  });

  console.log(`\n✅ 전체 업로드 완료: 성공 ${successful}개, 실패 ${failed}개`);

  return {
    successful,
    failed,
    results,
    elapsedTime,
  };
}
