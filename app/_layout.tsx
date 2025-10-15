import { Stack } from 'expo-router';
import 'react-native-reanimated';
import { useEffect } from 'react';
import { registerBackgroundUpload } from '@/services/backgroundUpload';

export default function RootLayout() {
  useEffect(() => {
    // 백그라운드 업로드 Task 등록
    registerBackgroundUpload().catch((error) => {
      console.error('백그라운드 업로드 등록 실패:', error);
    });
  }, []);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
    </Stack>
  );
}
