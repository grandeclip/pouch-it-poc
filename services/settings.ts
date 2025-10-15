import { MMKV } from 'react-native-mmkv';

const storage = new MMKV();

const SETTINGS_KEYS = {
  PARALLEL_UPLOAD: 'settings.parallel_upload',
};

/**
 * 병렬 업로드 설정 저장
 */
export function setParallelUploadEnabled(enabled: boolean): void {
  try {
    storage.set(SETTINGS_KEYS.PARALLEL_UPLOAD, enabled);
  } catch (error) {
    console.error('병렬 업로드 설정 저장 실패:', error);
  }
}

/**
 * 병렬 업로드 설정 불러오기 (기본값: true)
 */
export function getParallelUploadEnabled(): boolean {
  try {
    const value = storage.getBoolean(SETTINGS_KEYS.PARALLEL_UPLOAD);
    return value !== undefined ? value : true;
  } catch (error) {
    console.error('병렬 업로드 설정 불러오기 실패:', error);
    return true;
  }
}
