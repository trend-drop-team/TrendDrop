import { renderIcon } from "./icon-art";

// manifest.ts가 192·512를 /icon/192, /icon/512로 가리킨다. 브라우저 탭용 32px도 함께 낸다.
const SIZES = [32, 192, 512] as const;

export function generateImageMetadata() {
  return SIZES.map((side) => ({
    id: String(side),
    size: { width: side, height: side },
    contentType: "image/png",
  }));
}

export default async function Icon({ id }: { id: Promise<string | number> }) {
  const side = Number(await id);
  return renderIcon(SIZES.find((value) => value === side) ?? 192);
}
