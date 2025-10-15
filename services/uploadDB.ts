import { MMKV } from "react-native-mmkv";

/**
 * MMKV 스토리지 인스턴스
 */
const storage = new MMKV();

/**
 * 업로드 상태
 */
export type UploadStatus = "pending" | "uploading" | "success" | "failed";

/**
 * 업로드 레코드
 */
export interface UploadRecord {
  id: string;
  filename: string;
  uri: string;
  status: UploadStatus;
  retryCount: number;
  lastAttempt?: string; // ISO 8601 timestamp
  uploadedAt?: string; // ISO 8601 timestamp
  error?: string;
}

const STORAGE_KEY = "screenshot_upload_db";

/**
 * 전체 DB 로드
 */
export function loadUploadDB(): Record<string, UploadRecord> {
  try {
    const data = storage.getString(STORAGE_KEY);
    if (!data) return {};
    return JSON.parse(data);
  } catch (error) {
    console.error("DB 로드 실패:", error);
    return {};
  }
}

/**
 * 전체 DB 저장
 */
export function saveUploadDB(db: Record<string, UploadRecord>): void {
  try {
    storage.set(STORAGE_KEY, JSON.stringify(db));
  } catch (error) {
    console.error("DB 저장 실패:", error);
  }
}

/**
 * 특정 파일의 업로드 상태 저장
 */
export function saveUploadStatus(
  id: string,
  record: Partial<UploadRecord>
): void {
  const db = loadUploadDB();

  db[id] = {
    ...db[id],
    id,
    ...record,
  } as UploadRecord;

  saveUploadDB(db);
}

/**
 * 특정 파일의 업로드 상태 조회
 */
export function getUploadStatus(id: string): UploadRecord | null {
  const db = loadUploadDB();
  return db[id] || null;
}

/**
 * 업로드 성공으로 표시
 */
export function markAsUploaded(id: string): void {
  saveUploadStatus(id, {
    status: "success",
    uploadedAt: new Date().toISOString(),
    error: undefined,
  });
}

/**
 * 업로드 실패로 표시
 */
export function markAsFailed(id: string, error: string): void {
  const db = loadUploadDB();
  const record = db[id] || { id, retryCount: 0 };

  saveUploadStatus(id, {
    status: "failed",
    retryCount: record.retryCount + 1,
    lastAttempt: new Date().toISOString(),
    error,
  });
}

/**
 * 업로드가 필요한 파일 필터링
 * - 새 파일 (DB에 없음)
 * - pending 상태 파일
 * - failed 상태이지만 재시도 횟수가 3회 미만인 파일
 */
export function getNeedUploadFiles<T extends { id: string }>(
  screenshots: T[]
): T[] {
  const db = loadUploadDB();

  return screenshots.filter((screenshot) => {
    const record = db[screenshot.id];

    // DB에 없으면 새 파일
    if (!record) return true;

    // 성공한 파일은 제외
    if (record.status === "success") return false;

    // pending 또는 uploading 상태는 포함
    if (record.status === "pending" || record.status === "uploading") {
      return true;
    }

    // failed 상태이지만 재시도 횟수가 3회 미만이면 포함
    if (record.status === "failed" && record.retryCount < 3) {
      return true;
    }

    return false;
  });
}

/**
 * 모든 레코드 조회
 */
export function getAllRecords(): UploadRecord[] {
  const db = loadUploadDB();
  return Object.values(db);
}

/**
 * DB 초기화 (테스트용)
 */
export function clearUploadDB(): void {
  try {
    storage.delete(STORAGE_KEY);
  } catch (error) {
    console.error("DB 초기화 실패:", error);
  }
}

/**
 * 통계 조회
 */
export function getUploadStats(): {
  total: number;
  success: number;
  failed: number;
  pending: number;
} {
  const records = getAllRecords();

  return {
    total: records.length,
    success: records.filter((r) => r.status === "success").length,
    failed: records.filter((r) => r.status === "failed" && r.retryCount >= 3)
      .length,
    pending: records.filter(
      (r) =>
        r.status === "pending" ||
        r.status === "uploading" ||
        (r.status === "failed" && r.retryCount < 3)
    ).length,
  };
}
