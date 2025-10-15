import { MMKV } from "react-native-mmkv";

/**
 * 업로드 큐 전용 MMKV 스토리지
 */
const queueStorage = new MMKV({
  id: "upload-queue",
});

export interface QueueItem {
  id: string;
  uri: string;
  filename: string;
  addedAt: number;
  retryCount: number;
  status: "pending" | "uploading" | "failed";
  error?: string;
}

const QUEUE_KEY = "upload_queue";
const PROGRESS_KEY = "upload_progress";

/**
 * 큐에 파일 추가
 */
export function addToQueue(files: Array<{ id: string; uri: string; filename: string }>): void {
  const queue = getQueue();
  const now = Date.now();

  const newItems: QueueItem[] = files.map((file) => ({
    id: file.id,
    uri: file.uri,
    filename: file.filename,
    addedAt: now,
    retryCount: 0,
    status: "pending",
  }));

  // 중복 제거 (이미 큐에 있는 파일은 추가하지 않음)
  const existingIds = new Set(queue.map((item) => item.id));
  const uniqueNewItems = newItems.filter((item) => !existingIds.has(item.id));

  const updatedQueue = [...queue, ...uniqueNewItems];
  saveQueue(updatedQueue);

  console.log(`[Queue] ${uniqueNewItems.length}개 파일 추가 (총 ${updatedQueue.length}개)`);
}

/**
 * 큐에서 파일 제거
 */
export function removeFromQueue(fileId: string): void {
  const queue = getQueue();
  const updatedQueue = queue.filter((item) => item.id !== fileId);
  saveQueue(updatedQueue);

  console.log(`[Queue] 파일 제거: ${fileId} (남은 파일: ${updatedQueue.length}개)`);
}

/**
 * 여러 파일을 큐에서 제거
 */
export function removeMultipleFromQueue(fileIds: string[]): void {
  const queue = getQueue();
  const idsToRemove = new Set(fileIds);
  const updatedQueue = queue.filter((item) => !idsToRemove.has(item.id));
  saveQueue(updatedQueue);

  console.log(`[Queue] ${fileIds.length}개 파일 제거 (남은 파일: ${updatedQueue.length}개)`);
}

/**
 * 큐 전체 조회
 */
export function getQueue(): QueueItem[] {
  try {
    const queueJson = queueStorage.getString(QUEUE_KEY);
    if (!queueJson) return [];
    return JSON.parse(queueJson);
  } catch (error) {
    console.error("[Queue] 큐 조회 실패:", error);
    return [];
  }
}

/**
 * pending 상태인 파일만 조회
 */
export function getPendingItems(): QueueItem[] {
  return getQueue().filter((item) => item.status === "pending");
}

/**
 * 큐 저장
 */
function saveQueue(queue: QueueItem[]): void {
  try {
    queueStorage.set(QUEUE_KEY, JSON.stringify(queue));
  } catch (error) {
    console.error("[Queue] 큐 저장 실패:", error);
  }
}

/**
 * 파일 상태 업데이트
 */
export function updateQueueItemStatus(
  fileId: string,
  status: QueueItem["status"],
  error?: string
): void {
  const queue = getQueue();
  const updatedQueue = queue.map((item) => {
    if (item.id === fileId) {
      return {
        ...item,
        status,
        error,
        retryCount: status === "failed" ? item.retryCount + 1 : item.retryCount,
      };
    }
    return item;
  });
  saveQueue(updatedQueue);
}

/**
 * 여러 파일의 상태를 한 번에 업데이트
 */
export function updateMultipleItemsStatus(
  fileIds: string[],
  status: QueueItem["status"],
  error?: string
): void {
  const queue = getQueue();
  const idsToUpdate = new Set(fileIds);
  const updatedQueue = queue.map((item) => {
    if (idsToUpdate.has(item.id)) {
      return {
        ...item,
        status,
        error,
        retryCount: status === "failed" ? item.retryCount + 1 : item.retryCount,
      };
    }
    return item;
  });
  saveQueue(updatedQueue);
}

/**
 * 큐 초기화
 */
export function clearQueue(): void {
  queueStorage.delete(QUEUE_KEY);
  console.log("[Queue] 큐 초기화 완료");
}

/**
 * 큐가 비어있는지 확인
 */
export function isQueueEmpty(): boolean {
  return getQueue().length === 0;
}

/**
 * 업로드 진행 상황 저장
 */
export interface UploadProgress {
  current: number;
  total: number;
  isUploading: boolean;
  startTime?: number;
}

export function saveProgress(progress: UploadProgress): void {
  try {
    queueStorage.set(PROGRESS_KEY, JSON.stringify(progress));
  } catch (error) {
    console.error("[Queue] 진행 상황 저장 실패:", error);
  }
}

export function getProgress(): UploadProgress | null {
  try {
    const progressJson = queueStorage.getString(PROGRESS_KEY);
    if (!progressJson) return null;
    return JSON.parse(progressJson);
  } catch (error) {
    console.error("[Queue] 진행 상황 조회 실패:", error);
    return null;
  }
}

export function clearProgress(): void {
  queueStorage.delete(PROGRESS_KEY);
}
