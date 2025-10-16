import * as MediaLibrary from "expo-media-library";

export interface ScreenshotAsset {
  id: string;
  uri: string;
  filename: string;
  creationTime: number;
}

/**
 * Screenshots 폴더에서 모든 사진 가져오기
 */
export async function getScreenshotsFromLibrary(): Promise<ScreenshotAsset[]> {
  try {
    // 모든 앨범 가져오기
    const albums = await MediaLibrary.getAlbumsAsync({
      includeSmartAlbums: true,
    });

    albums.forEach((album) => {
      console.log(`- ${album.title} (${album.assetCount}개)`);
    });

    // Screenshots 앨범 찾기 (다양한 이름 지원)
    const screenshotAlbum = albums.find((album) => {
      const title = album.title.toLowerCase();
      return (
        title === "screenshots" ||
        title === "screenshot" ||
        title.includes("스크린샷") ||
        title.includes("화면 캡처")
      );
    });

    if (!screenshotAlbum) {
      console.log("❌ Screenshots 폴더를 찾을 수 없습니다.");
      return [];
    }

    console.log(
      `✅ "${screenshotAlbum.title}" 앨범을 찾았습니다. (${screenshotAlbum.assetCount}개)`
    );

    // Screenshots 앨범의 모든 사진 가져오기
    const albumAssets = await MediaLibrary.getAssetsAsync({
      album: screenshotAlbum,
      mediaType: MediaLibrary.MediaType.photo,
      first: 100, // 최대 10개까지 가져오기
      sortBy: MediaLibrary.SortBy.creationTime,
    });

    // 필요한 정보만 추출
    const screenshots: ScreenshotAsset[] = albumAssets.assets.map((asset) => ({
      id: asset.id,
      uri: asset.uri,
      filename: asset.filename,
      creationTime: asset.creationTime,
    }));

    console.log(`📸 Screenshots ${screenshots.length}개를 찾았습니다.`);
    return screenshots;
  } catch (error) {
    console.error("❌ Screenshots 가져오기 실패:", error);
    return [];
  }
}

/**
 * 특정 날짜 이후의 Screenshots만 가져오기
 */
export async function getRecentScreenshots(
  afterTimestamp: number
): Promise<ScreenshotAsset[]> {
  const allScreenshots = await getScreenshotsFromLibrary();
  return allScreenshots.filter(
    (screenshot) => screenshot.creationTime > afterTimestamp
  );
}
