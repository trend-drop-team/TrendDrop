---
name: verify-ui
description: TrendDrop UI 품질 게이트를 한 방에 검사(tsc·lint·build·className 커버리지·렌더 순수성·팀파일 무수정). UI 변경을 커밋하기 전, 또는 서브에이전트가 기능 구현을 끝냈을 때 실행.
---

# verify-ui

이 프로젝트에서 매 작업마다 반복하던 검증을 한 명령으로:

```bash
npm run verify:ui
```

`scripts/verify-ui.mjs`가 도는 것:

**하드 게이트** (하나라도 실패하면 exit 1 — 커밋 전 전부 초록이어야 함)
1. `tsc --noEmit`
2. `eslint`
3. `next build`
4. **className 커버리지** — `app/**`+`components/**`의 `.tsx`가 쓰는 모든 className이 어떤 `.css`엔가 규칙으로 존재. globals를 다시 쓸 때 팀 api-lab 클래스 같은 게 조용히 사라지는 걸 잡는다.

**소프트 체크** (경고만)
5. **렌더 순수성** — 우리 소스에 `Math.random`/`Date.now`/`new Date` (하이드레이션 리스크). 렌더 중이면 `useEffect`로 옮기고, 정말 서버 전용이라 안전하면 그 줄에 `// verify-ui-allow`.
6. **보호 경로** — 팀 소유 파일(api-lab, api/**, components, 수집기, db, collection-log*)이 변경됐는지 경고.

마지막에 `next build`가 만든 `next-env.d.ts`/`tsconfig.json` drift를 되돌린다.

## 실패했을 때
- **className ✗**: 쓰는 클래스에 CSS 규칙이 없음. 규칙을 추가하거나, 코-클래스로 스타일되는 마커면 스크립트의 `MARKUP_ONLY`에 추가.
- **렌더 순수성 ⚠**: 그 호출을 effect 안으로(하이드레이션 안전), 또는 정당한 서버 전용이면 `// verify-ui-allow`.
- **보호 경로 ⚠**: 팀 파일 변경이 의도한 것인지 확인 — 보통은 되돌려야 함.

하드 게이트가 전부 ✓가 될 때까지 고치고 재실행.
