/**
 * 레거시 백그라운드 업로드 서비스
 *
 * 이 파일은 unifiedUpload.ts로 통합되었습니다.
 * 하위 호환성을 위해 함수들을 리다이렉트합니다.
 */

import {
  registerPeriodicUpload,
  unregisterPeriodicUpload,
  UNIFIED_UPLOAD_TASK,
} from "./unifiedUpload";
import * as TaskManager from "expo-task-manager";

// 하위 호환성을 위한 상수
export const BACKGROUND_UPLOAD_TASK = UNIFIED_UPLOAD_TASK;

/**
 * 백그라운드 업로드 Task 등록
 * @deprecated unifiedUpload의 registerPeriodicUpload 사용 권장
 */
export async function registerBackgroundUpload(): Promise<void> {
  console.log("[BackgroundUpload] registerPeriodicUpload로 리다이렉트");
  return registerPeriodicUpload();
}

/**
 * 백그라운드 업로드 Task 해제
 * @deprecated unifiedUpload의 unregisterPeriodicUpload 사용 권장
 */
export async function unregisterBackgroundUpload(): Promise<void> {
  console.log("[BackgroundUpload] unregisterPeriodicUpload로 리다이렉트");
  return unregisterPeriodicUpload();
}

/**
 * 백그라운드 Task 상태 확인
 */
export async function getBackgroundUploadStatus(): Promise<{
  isRegistered: boolean;
}> {
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(UNIFIED_UPLOAD_TASK);

    return {
      isRegistered,
    };
  } catch (error) {
    console.error("[BackgroundUpload] 상태 확인 실패:", error);
    return {
      isRegistered: false,
    };
  }
}
