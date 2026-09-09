/** 0~100으로 정규화. 전부 같은 값이면 중간값(50)으로 눕힌다. */
export function normalize(values: number[]): number[] {
  if (values.length === 0) return [];

  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max - min < 0.001) return values.map(() => 50);

  return values.map((value) => Math.round(((value - min) / (max - min)) * 100));
}
