# P02 Figma 속성 → React Native·웹(CSS) 대응표

작성: 조대흠, 2026-10-06. Figma 디자인 속성이 구현에서 어떤 스타일로 대응되어야 하는지, 그리고 대응이 틀렸을 때 측정으로 어떻게 드러나는지 정리한 프로젝트 문서다. 괄호의 O로 시작하는 번호는 같은 지식베이스의 공식 문서 출처다.

## 1. 오토 레이아웃 방향·간격·패딩

| Figma | React Native | 웹(CSS) | 출처 |
|---|---|---|---|
| Auto layout 가로(Horizontal) | `flexDirection: 'row'` | `flex-direction: row` | O01, O08 |
| Auto layout 세로(Vertical) | `flexDirection: 'column'`(RN 기본값) | `flex-direction: column` | O01, O08 |
| 항목 간격(Spacing between items) | `gap` | `gap` | O01, O08 |
| 패딩(Padding) | `padding`, `paddingHorizontal` 등 | `padding` | O01 |
| 줄바꿈(Wrap) | `flexWrap: 'wrap'` | `flex-wrap: wrap` | O01, O08 |
| 정렬(Alignment) | `justifyContent`(주축), `alignItems`(교차축) | 같음 | O01, O08 |

React Native의 flexbox는 웹과 기본값이 다르다. `flexDirection` 기본값은 column, `flexShrink` 기본값은 0이다(웹은 1). (O08)

## 2. 크기 규칙(Hug·Fill·Fixed·최소·최대)

Figma의 크기 규칙은 다섯 가지다. Hug contents는 자식에 맞춰 크기가 정해지고 오토 레이아웃 프레임에만 쓴다. Fill container는 부모의 남은 공간을 채우고 오토 레이아웃의 자식에만 쓴다. Fixed는 크기가 고정된다. 최소·최대 너비는 그 범위를 지킨다. 자식 중 하나라도 Fill container면 부모는 그 축에서 Hug가 아니라 Fixed가 된다. (O01) 플러그인 API의 `layoutSizingHorizontal`은 FIXED·HUG·FILL 세 값을 가진다. (O07)

| Figma 크기 규칙 | React Native 구현 | 측정으로 확인하는 법 |
|---|---|---|
| Fill container(주축) | `flex: 1` 또는 `flexGrow: 1` + `flexBasis: 0`. 웹에서 줄어들어야 하면 `minWidth: 0`도 필요(아래 4절) | 화면 폭을 바꿔도 부모 폭에서 형제·간격을 뺀 만큼을 따라가는가 |
| Fill container(교차축) | `alignSelf: 'stretch'`(부모 alignItems가 stretch면 기본) | 부모 교차축 크기와 같은가 |
| Hug contents | 너비를 지정하지 않음(내용 크기, RN 기본 auto) | 내용(글자) 길이가 바뀔 때 크기가 따라 바뀌는가 |
| Fixed | `width: N` / `height: N` | 화면 폭이 바뀌어도 N을 유지하는가 |
| Min / Max width | `minWidth` / `maxWidth` | 작은 화면에서 최소값 아래로 줄지 않는가 |

## 3. 제약(Constraints) — 오토 레이아웃이 아닌 프레임

제약은 프레임 크기가 바뀔 때 레이어가 어떻게 반응할지 정한다. Left·Right·Left and right·Center·Scale이 있고, 오토 레이아웃 프레임 안의 레이어에는 적용할 수 없다. (O03)

| Figma 제약 | React Native 구현 |
|---|---|
| Left | `position: 'absolute', left: x` |
| Right | `position: 'absolute', right: x` |
| Left and right | `left`와 `right`를 모두 지정(폭이 늘어남) |
| Center | 부모를 기준으로 가운데 정렬 |
| Scale | 퍼센트 폭·위치(`width: '50%'` 등) |

반응형 카드처럼 오토 레이아웃과 제약을 함께 쓰는 예는 O02에 있다.

## 4. 웹에서만 생기는 함정: 입력칸과 flex 아이템의 최소 너비

- React Native의 TextInput은 웹에서 `<input>`으로 그려진다.
- `<input type="text">`의 size 속성 기본값은 20(글자 수)이다. 그래서 너비를 지정하지 않아도 글꼴에 따라 정해지는 고유 너비를 가진다. (O14)
- 웹에서 flex 아이템의 자동 최소 너비(min-width: auto)는 min-content 크기다. (O12) 그래서 flex 줄 안의 `<input>`은 `flex: 1`만으로는 고유 너비보다 작게 줄지 않고 부모 밖으로 넘친다. flex 아이템의 비율과 축소는 O13에 설명돼 있다.
- **대응:** 줄어들어야 하는 입력칸과 그 부모에 `minWidth: 0`을 준다.
- **측정:** 가장 오른쪽 입력칸의 right가 부모의 right보다 크면 넘침이다.

## 5. 안전영역과 탭바

- iOS 기기는 화면 아래에 홈 인디케이터 영역이 있다. 웹에서는 `env(safe-area-inset-bottom)`으로 이 값을 읽으며, 데스크톱에서는 0이다. (O15)
- 아이폰 X 기준 시안(375×812)의 탭바 높이에는 홈 인디케이터 몫이 들어 있는 경우가 많다. 이를 고정 높이로 옮기면 기기마다 라벨이 잘리거나 막대와 겹친다.
- **대응:** 탭바 내용 높이를 고정하고 안전영역을 더한다. 탭바 스타일은 React Navigation의 `tabBarStyle`로 정한다. (O17)
- **측정:** 탭 라벨의 박스가 화면 아래 막대(홈 인디케이터)나 화면 밖과 겹치는가.

## 6. 상태(변형) → 구현

Figma 변형은 컴포넌트의 상태 같은 속성을 값으로 나눈다. 예를 들어 버튼의 State 속성은 default·hover·pressed·disabled 값을 가질 수 있다. (O04, O05, O18)

| Figma 변형 | React Native 구현 | 웹 측정 방법 |
|---|---|---|
| State=Pressed | `Pressable`의 `style={({ pressed }) => ...}` (O11) | 누르는 동안의 계산 스타일(배경색·불투명도) |
| State=Disabled | `disabled` 속성 + 비활성 스타일 | 비활성 조건을 만든 뒤 스타일·누름 반응 |
| State=Focused | 포커스 스타일 | `:focus-visible`은 키보드 포커스 때만 보이는 것이 원칙 (O16) |
| State=Hover(웹) | `Pressable`의 hovered 상태 | 마우스를 올린 뒤 계산 스타일 |

손가락이나 마우스로 누를 때 포커스 테두리가 보이면, 디자인에 없는 상태가 드러난 결함 후보다. 브라우저는 포인터로 누를 때 보통 포커스 표시를 하지 않는다. (O16)

## 7. 변수·스타일 → 디자인 토큰

- Figma 변수는 재사용 값(색·숫자·문자열)을 저장하고, 모드(예: 라이트·다크)로 값을 바꾼다. (O06)
- 구현에서는 토큰 파일(예: `theme/tokens.ts`)의 이름으로 참조해야 한다.
- 같은 값을 hex로 직접 쓰면 화면은 같아 보여도 디자인 시스템 결함이다. 테마나 값이 바뀔 때 함께 바뀌지 않기 때문이다.
- **측정과 확인:** 화면에서 측정한 색·글꼴이 토큰 값과 같은지 먼저 본다. 같다면 코드 검색으로 토큰 참조인지, 값 하드코딩인지 확인한다.
