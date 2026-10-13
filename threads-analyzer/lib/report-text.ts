import type { Condition, Formula } from "./report";

/** 조건 하나를 "~한" 꼴의 쉬운 말로 바꿉니다. */
const PHRASES: Record<string, (v: string) => string> = {
  timeslot: (v) => `${v}에 올린`,
  dayType: (v) => `${v}에 올린`,
  media: (v) =>
    ({ 텍스트: "글만 쓴", 사진: "사진을 넣은", 영상: "영상을 넣은", "여러 장": "사진 여러 장을 넣은" })[v] ?? `${v} 형식의`,
  length: (v) =>
    ({ 짧음: "짧은(60자 미만)", 보통: "보통 길이(60~200자)의", 김: "긴(200자 이상)" })[v.split(" ")[0]] ?? `${v} 길이의`,
  hook: (v) => `${v} 첫 문장으로 시작한`,
  structure: (v) => `${v} 흐름의`,
  cta: (v) =>
    ({ "정보 요청": "정보를 물어본", "의견 요청": "의견을 물어본", "공감 요청": "공감을 구한", "유도 없음": "반응을 따로 요청하지 않은" })[v] ??
    `${v}한`,
  emotion: (v) =>
    ({ 호기심: "호기심을 자극한", 공감: "공감을 부른", 웃김: "웃음을 준", "답답함·분노": "답답함을 드러낸", 감동: "감동을 준", 담담함: "담담한" })[v] ??
    `${v}을 준`,
  topic: (v) => `'${v}' 주제의`,
};

export function conditionPhrase(c: Condition): string {
  return (PHRASES[c.dim] ?? ((v: string) => v))(c.value);
}

/** 예: "평일 밤 21~24시에 올린, 정보를 물어본 글" */
export function formulaSentence(f: Pick<Formula, "conditions">): string {
  const day = f.conditions.find((c) => c.dim === "dayType");
  const time = f.conditions.find((c) => c.dim === "timeslot");
  const rest = f.conditions.filter((c) => c !== day && c !== time).map(conditionPhrase);
  // 요일과 시간대가 함께 있으면 "평일 밤 21~24시에 올린"처럼 한 번에 씁니다.
  const when = day && time ? `${day.value} ${time.value}에 올린` : day ? conditionPhrase(day) : time ? conditionPhrase(time) : null;
  return `${[when, ...rest].filter(Boolean).join(", ")} 글`;
}

export function formulaResult(f: Formula): string {
  return `${f.n}개 중 ${f.hits}개 터짐 (${Math.round(f.rate * 100)}%) · 평소의 ${f.avgMultiple.toFixed(1)}배`;
}
