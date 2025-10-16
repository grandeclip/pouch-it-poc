import { MMKV } from "react-native-mmkv";

/**
 * 업로드 진행 상황 전용 스토리지
 */
const progressStorage = new MMKV({
  id: "upload-progress",
});

const PROGRESS_KEY = "upload_progress";

/**
 * 업로드 진행 상황
 */
export interface UploadProgress {
  current: number;
  total: number;
  isUploading: boolean;
  startTime?: number;
}

/**
 * 업로드 진행 상황 저장
 */
export function saveProgress(progress: UploadProgress): void {
  try {
    progressStorage.set(PROGRESS_KEY, JSON.stringify(progress));
  } catch (error) {
    console.error("[Progress] 진행 상황 저장 실패:", error);
  }
}

/**
 * 업로드 진행 상황 조회
 */
export function getProgress(): UploadProgress | null {
  try {
    const progressJson = progressStorage.getString(PROGRESS_KEY);
    if (!progressJson) return null;
    return JSON.parse(progressJson);
  } catch (error) {
    console.error("[Progress] 진행 상황 조회 실패:", error);
    return null;
  }
}

/**
 * 업로드 진행 상황 초기화
 */
export function clearProgress(): void {
  progressStorage.delete(PROGRESS_KEY);
}
