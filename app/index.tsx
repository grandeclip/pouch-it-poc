import { getScreenshotsFromLibrary, ScreenshotAsset } from "@/services/media";
import { requestAllPermissions } from "@/services/permissions";
import {
  getParallelUploadEnabled,
  setParallelUploadEnabled as saveParallelUploadSetting,
} from "@/services/settings";
import { uploadScreenshots } from "@/services/upload";
import {
  clearUploadDB,
  getAllRecords,
  getNeedUploadFiles,
} from "@/services/uploadDB";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  AppStateStatus,
  FlatList,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

type UploadStatus =
  | "idle"
  | "requesting-permission"
  | "loading"
  | "uploading"
  | "completed"
  | "error";

interface UploadItem extends ScreenshotAsset {
  status: "pending" | "uploading" | "success" | "failed";
  error?: string;
}

export default function UploadScreen() {
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [screenshots, setScreenshots] = useState<UploadItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [startTime, setStartTime] = useState<number>(0);
  const [elapsedTime, setElapsedTime] = useState<number>(0);
  const [autoUploadEnabled, setAutoUploadEnabled] = useState<boolean>(true);
  const [parallelUploadEnabled, setParallelUploadEnabled] =
    useState<boolean>(true);
  const [hasDBData, setHasDBData] = useState<boolean>(false);

  useEffect(() => {
    checkDBData();
    const loadedParallelSetting = loadSettings();

    // 통합 업로드 시스템 초기화
    import("@/services/unifiedUpload").then(({ registerPeriodicUpload }) => {
      registerPeriodicUpload();
    });

    if (autoUploadEnabled) {
      initializeUpload(loadedParallelSetting);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function loadSettings(): boolean {
    const parallel = getParallelUploadEnabled();
    setParallelUploadEnabled(parallel);
    return parallel;
  }

  function checkDBData() {
    const records = getAllRecords();
    setHasDBData(records.length > 0);
  }
  useEffect(() => {
    let previousAppState = AppState.currentState;
    let backgroundLogInterval: ReturnType<typeof setInterval> | undefined;
    let backgroundCount = 0; // 백그라운드 카운터 (useEffect 스코프로 이동)

    const subscription = AppState.addEventListener(
      "change",
      (nextAppState: AppStateStatus) => {
        console.log(`[AppState] ${previousAppState} -> ${nextAppState}`);

        // 백그라운드 진입 (inactive는 제외, background만)
        if (nextAppState === "background") {
          console.log("🌙 [백그라운드] 진입 - 1초마다 로그 시작");

          // 카운터 리셋
          backgroundCount = 0;

          // 1초마다 로그 찍기
          backgroundLogInterval = setInterval(() => {
            backgroundCount++;
            const currentState = AppState.currentState;
            console.log(`🌙 [백그라운드 활성] ${backgroundCount}초 경과 - AppState: ${currentState} - 업로드: ${status}`);
          }, 1000);

          console.log("🌙 [디버그] setInterval 등록 완료");
        }

        // 포그라운드 복귀 (active 상태)
        if (nextAppState === "active") {
          console.log("☀️ [포그라운드] 복귀");

          // 백그라운드 로그 중지
          if (backgroundLogInterval) {
            clearInterval(backgroundLogInterval);
            backgroundLogInterval = undefined;
            console.log(`🌙 [백그라운드] 로그 중지 - 총 ${backgroundCount}초 경과`);
          }

          if (autoUploadEnabled && status !== "uploading") {
            console.log("[AppState] 포그라운드 복귀 - 스캔 시작");
            initializeUpload();
          }
        }

        previousAppState = nextAppState;
      }
    );

    return () => {
      subscription.remove();
      if (backgroundLogInterval) {
        clearInterval(backgroundLogInterval);
      }
    };
  }, [autoUploadEnabled, status]);

  // 업로드 중일 때 경과 시간 업데이트
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (status === "uploading" && startTime > 0) {
      interval = setInterval(() => {
        setElapsedTime(Date.now() - startTime);
      }, 100); // 0.1초마다 업데이트
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [status, startTime]);

  async function initializeUpload(parallelMode?: boolean) {
    try {
      // 1. 권한 요청
      setStatus("requesting-permission");
      console.log("권한 요청 시작...");
      const permissions = await requestAllPermissions();

      if (!permissions.camera || !permissions.mediaLibrary) {
        setStatus("error");
        setErrorMessage("카메라 및 사진 라이브러리 권한이 필요합니다.");
        return;
      }

      // 2. Screenshots 스캔
      setStatus("loading");
      console.log("Screenshots 폴더 스캔 중...");
      const foundScreenshots = await getScreenshotsFromLibrary();

      if (foundScreenshots.length === 0) {
        setStatus("completed");
        setErrorMessage("업로드할 스크린샷이 없습니다.");
        return;
      }

      // 3. DB에서 업로드 필요한 파일만 필터링
      console.log(`총 ${foundScreenshots.length}개 스크린샷 발견`);
      const needUpload = getNeedUploadFiles(foundScreenshots);
      console.log(`업로드 필요: ${needUpload.length}개`);

      if (needUpload.length === 0) {
        setStatus("completed");
        setErrorMessage("모든 스크린샷이 이미 업로드되었습니다.");
        return;
      }

      // 4. 업로드 준비
      const uploadItems: UploadItem[] = needUpload.map((screenshot) => ({
        ...screenshot,
        status: "pending",
      }));
      setScreenshots(uploadItems);

      // 5. 업로드 시작
      setStatus("uploading");
      await startUpload(uploadItems, parallelMode);
    } catch (error) {
      setStatus("error");
      setErrorMessage("앱 초기화 중 오류가 발생했습니다.");
      console.error("앱 초기화 오류:", error);
    }
  }

  async function startUpload(items: UploadItem[], parallelMode?: boolean) {
    setStartTime(Date.now());

    const filesToUpload = items.map((item) => ({
      id: item.id,
      uri: item.uri,
      filename: item.filename,
    }));

    const useParallel = parallelMode !== undefined ? parallelMode : parallelUploadEnabled;

    const result = await uploadScreenshots(
      filesToUpload,
      undefined,
      (current, total) => {
        setCurrentIndex(current);
        setScreenshots((prev) =>
          prev.map((item, index) => {
            if (index < current - 1) {
              return { ...item, status: "success" };
            } else if (index === current - 1) {
              return { ...item, status: "uploading" };
            }
            return item;
          })
        );
      },
      { parallel: useParallel }
    );

    // 최종 상태 업데이트
    setScreenshots((prev) =>
      prev.map((item, index) => ({
        ...item,
        status: result.results[index]?.success ? "success" : "failed",
        error: result.results[index]?.error,
      }))
    );

    setElapsedTime(result.elapsedTime);
    setStatus("completed");
    checkDBData();
  }

  function handleClearDB() {
    clearUploadDB();
    setHasDBData(false);
    setScreenshots([]);
    setStatus("idle");
  }

  function handleParallelUploadToggle(value: boolean) {
    setParallelUploadEnabled(value);
    saveParallelUploadSetting(value);
  }

  function renderStatusMessage() {
    switch (status) {
      case "requesting-permission":
        return (
          <View style={styles.statusContainer}>
            <ActivityIndicator size="large" color="#007AFF" />
            <Text style={styles.statusText}>권한 요청 중...</Text>
          </View>
        );

      case "loading":
        return (
          <View style={styles.statusContainer}>
            <ActivityIndicator size="large" color="#007AFF" />
            <Text style={styles.statusText}>스크린샷 검색 중...</Text>
          </View>
        );

      case "uploading":
        const totalCount = screenshots.length;
        const successCount = screenshots.filter(
          (s) => s.status === "success"
        ).length;
        const progress =
          totalCount > 0 ? ((successCount / totalCount) * 100).toFixed(0) : 0;

        // 경과 시간 포맷팅
        const seconds = Math.floor(elapsedTime / 1000);
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        const timeText =
          minutes > 0
            ? `${minutes}분 ${remainingSeconds}초`
            : `${remainingSeconds}초`;

        return (
          <View style={styles.headerContainer}>
            <Text style={styles.headerTitle}>업로드 중</Text>
            <Text style={styles.headerProgress}>
              {successCount} / {totalCount} ({progress}%)
            </Text>
            <Text style={styles.headerTime}>⏱️ {timeText}</Text>
          </View>
        );

      case "completed":
        const successfulCount = screenshots.filter(
          (s) => s.status === "success"
        ).length;
        const failedCount = screenshots.filter(
          (s) => s.status === "failed"
        ).length;

        // 총 소요 시간 계산 (밀리초 포함)
        const totalMilliseconds = elapsedTime;
        const totalSeconds = Math.floor(totalMilliseconds / 1000);
        const totalMinutes = Math.floor(totalSeconds / 60);
        const totalRemainingSeconds = totalSeconds % 60;
        const milliseconds = totalMilliseconds % 1000;

        const totalTimeText =
          totalMinutes > 0
            ? `${totalMinutes}분 ${totalRemainingSeconds}.${milliseconds.toString().padStart(3, '0')}초`
            : `${totalRemainingSeconds}.${milliseconds.toString().padStart(3, '0')}초`;

        return (
          <View style={styles.headerContainer}>
            <Text style={styles.headerTitle}>업로드 완료</Text>
            <Text style={styles.headerSubtitle}>
              성공: {successfulCount}개{" "}
              {failedCount > 0 && `/ 실패: ${failedCount}개`}
            </Text>
            {elapsedTime > 0 && (
              <Text style={styles.headerTime}>
                ⏱️ 총 소요 시간: {totalTimeText}
              </Text>
            )}
          </View>
        );

      case "error":
        return (
          <View style={styles.errorContainer}>
            <Text style={styles.errorIcon}>⚠️</Text>
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        );

      default:
        return null;
    }
  }

  function renderItem({ item }: { item: UploadItem }) {
    const getStatusIcon = () => {
      switch (item.status) {
        case "pending":
          return "⏳";
        case "uploading":
          return "📤";
        case "success":
          return "✅";
        case "failed":
          return "❌";
      }
    };

    const getStatusColor = () => {
      switch (item.status) {
        case "pending":
          return "#999";
        case "uploading":
          return "#007AFF";
        case "success":
          return "#34C759";
        case "failed":
          return "#FF3B30";
      }
    };

    return (
      <View style={styles.listItem}>
        <Text style={styles.statusIcon}>{getStatusIcon()}</Text>
        <View style={styles.itemContent}>
          <Text style={styles.filename} numberOfLines={1}>
            {item.filename}
          </Text>
          {item.error && <Text style={styles.errorDetail}>{item.error}</Text>}
        </View>
        {item.status === "uploading" && (
          <ActivityIndicator size="small" color={getStatusColor()} />
        )}
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />

      {/* 자동 업로드 토글 */}
      <View style={styles.toggleContainer}>
        <View style={styles.toggleTextContainer}>
          <Text style={styles.toggleTitle}>자동 업로드</Text>
          <Text style={styles.toggleSubtitle}>
            앱 시작 시 스크린샷 자동 업로드
          </Text>
        </View>
        <Switch
          value={autoUploadEnabled}
          onValueChange={setAutoUploadEnabled}
          trackColor={{ false: "#E5E5EA", true: "#34C759" }}
          thumbColor={autoUploadEnabled ? "#FFF" : "#F4F3F4"}
          ios_backgroundColor="#E5E5EA"
        />
      </View>

      {/* 병렬 업로드 토글 */}
      <View style={styles.toggleContainer}>
        <View style={styles.toggleTextContainer}>
          <Text style={styles.toggleTitle}>병렬 업로드</Text>
          <Text style={styles.toggleSubtitle}>
            {parallelUploadEnabled
              ? "여러 배치를 동시에 업로드 (빠름)"
              : "배치를 순차적으로 업로드 (안정적, 직렬 방식)"}
          </Text>
        </View>
        <Switch
          value={parallelUploadEnabled}
          onValueChange={handleParallelUploadToggle}
          trackColor={{ false: "#E5E5EA", true: "#007AFF" }}
          thumbColor={parallelUploadEnabled ? "#FFF" : "#F4F3F4"}
          ios_backgroundColor="#E5E5EA"
        />
      </View>

      {/* DB 초기화 버튼 */}
      <View style={styles.clearButtonContainer}>
        <TouchableOpacity
          style={[styles.clearButton, !hasDBData && styles.clearButtonDisabled]}
          onPress={handleClearDB}
          disabled={!hasDBData}
        >
          <Text
            style={[
              styles.clearButtonText,
              !hasDBData && styles.clearButtonTextDisabled,
            ]}
          >
            🗑️ 로컬 DB 초기화
          </Text>
        </TouchableOpacity>
        <Text style={styles.clearButtonHint}>
          {hasDBData
            ? "업로드 기록을 모두 삭제합니다"
            : "초기화할 데이터가 없습니다"}
        </Text>
      </View>

      {renderStatusMessage()}

      {screenshots.length > 0 && (
        <FlatList
          data={screenshots}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F2F2F7",
  },
  toggleContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#FFF",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E5EA",
  },
  toggleTextContainer: {
    flex: 1,
    marginRight: 12,
  },
  toggleTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: "#000",
    marginBottom: 2,
  },
  toggleSubtitle: {
    fontSize: 13,
    color: "#666",
  },
  statusContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  statusText: {
    marginTop: 16,
    fontSize: 16,
    color: "#666",
  },
  headerContainer: {
    backgroundColor: "#FFF",
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E5EA",
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: "bold",
    color: "#000",
    marginBottom: 4,
  },
  headerProgress: {
    fontSize: 16,
    color: "#007AFF",
    fontWeight: "600",
  },
  headerSubtitle: {
    fontSize: 16,
    color: "#666",
  },
  headerTime: {
    fontSize: 14,
    color: "#007AFF",
    fontWeight: "500",
    marginTop: 8,
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 40,
  },
  errorIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  errorText: {
    fontSize: 18,
    color: "#FF3B30",
    textAlign: "center",
  },
  listContent: {
    padding: 16,
  },
  listItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF",
    padding: 16,
    marginBottom: 8,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  statusIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  itemContent: {
    flex: 1,
  },
  filename: {
    fontSize: 14,
    color: "#000",
    fontWeight: "500",
  },
  errorDetail: {
    fontSize: 12,
    color: "#FF3B30",
    marginTop: 4,
  },
  clearButtonContainer: {
    backgroundColor: "#FFF",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E5EA",
  },
  clearButton: {
    backgroundColor: "#FF3B30",
    padding: 14,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  clearButtonDisabled: {
    backgroundColor: "#E5E5EA",
  },
  clearButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#FFF",
  },
  clearButtonTextDisabled: {
    color: "#C7C7CC",
  },
  clearButtonHint: {
    fontSize: 13,
    color: "#666",
    textAlign: "center",
    marginTop: 8,
  },
});
