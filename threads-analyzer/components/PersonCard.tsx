import type { PersonCard as Card } from "@/lib/types";

/** 댓글 옆에 붙는 작은 인물 카드 */
export default function PersonCard({ person, onOpen }: { person: Card | null; onOpen?: (id: string) => void }) {
  if (!person) return <div className="pcard muted tiny">비공개 계정이라 아이디가 보이지 않아 기억할 수 없어요.</div>;
  if (person.forgotten) return <div className="pcard muted tiny">기억하지 않기로 한 사람이에요.</div>;

  return (
    <div className="pcard">
      <div className="pcard-head">
        <span className="tiny muted">
          대화 {person.commentCount}번{person.facts.length ? ` · 기억 ${person.facts.length}개` : ""}
        </span>
        {onOpen && (
          <button className="link-btn tiny" onClick={() => onOpen(person.id)}>
            카드 전체 보기 →
          </button>
        )}
      </div>
      {person.facts.length ? (
        <ul className="chips">
          {person.facts.map((f) => (
            <li key={f.id} className={`chip cat-${f.category}`} title={f.sourceText ? `“${f.sourceText}”` : "직접 입력"}>
              <span className="chip-label">{f.label}</span> {f.value}
            </li>
          ))}
        </ul>
      ) : (
        <p className="tiny muted">
          {person.pending ? "아직 정리 전이에요. 새 댓글 가져오기를 누르면 정리해요." : "댓글에 본인 이야기가 없어서 기억한 정보가 없어요."}
        </p>
      )}
      {person.notes && <p className="pcard-notes tiny">메모: {person.notes}</p>}
    </div>
  );
}
