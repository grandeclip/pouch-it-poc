import { Camera } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library';

export interface PermissionsResult {
  camera: boolean;
  mediaLibrary: boolean;
}

/**
 * 카메라 권한 요청
 */
export async function requestCameraPermission(): Promise<boolean> {
  try {
    const { status } = await Camera.requestCameraPermissionsAsync();
    return status === 'granted';
  } catch (error) {
    console.error('카메라 권한 요청 실패:', error);
    return false;
  }
}

/**
 * 미디어 라이브러리(사진) 권한 요청
 */
export async function requestMediaLibraryPermission(): Promise<boolean> {
  try {
    const { status } = await MediaLibrary.requestPermissionsAsync();
    return status === 'granted';
  } catch (error) {
    console.error('미디어 라이브러리 권한 요청 실패:', error);
    return false;
  }
}

/**
 * 모든 필요한 권한 요청
 */
export async function requestAllPermissions(): Promise<PermissionsResult> {
  const cameraGranted = await requestCameraPermission();
  const mediaLibraryGranted = await requestMediaLibraryPermission();

  return {
    camera: cameraGranted,
    mediaLibrary: mediaLibraryGranted,
  };
}

/**
 * 현재 권한 상태 확인
 */
export async function checkPermissions(): Promise<PermissionsResult> {
  try {
    const cameraPermission = await Camera.getCameraPermissionsAsync();
    const mediaPermission = await MediaLibrary.getPermissionsAsync();

    return {
      camera: cameraPermission.status === 'granted',
      mediaLibrary: mediaPermission.status === 'granted',
    };
  } catch (error) {
    console.error('권한 상태 확인 실패:', error);
    return {
      camera: false,
      mediaLibrary: false,
    };
  }
}
