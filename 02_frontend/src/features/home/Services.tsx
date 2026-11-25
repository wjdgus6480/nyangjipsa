import { useNavigate } from "react-router";
import { ROUTES } from "../../services/config/site";
import { scrollToSection } from "../../components/common/scroll";
import { SERVICES } from "./content";
import { ICONS } from "./icons";

export function Services({ onOpenGuide }: { onOpenGuide(id: string): void }) {
  const navigate = useNavigate();
  return (
    <section id="services" className="section section--soft">
      <div className="container">
        <div className="section__head reveal">
          <span className="eyebrow">주요 서비스</span>
          <h2>초보 집사를 위한 똑똑한 건강관리</h2>
        </div>
        <div className="grid grid--4">
          {SERVICES.map((s) => (
            <article key={s.title} className="card card--service reveal">
              <div className="card__icon">{ICONS[s.icon]}</div>
              <h3>{s.title}</h3>
              <ul className="checks">
                {s.points.map((p) => <li key={p}>{p}</li>)}
              </ul>
              <button
                className="btn btn--ghost"
                onClick={() => {
                  const a = s.action;
                  if (a.type === "scroll") scrollToSection(a.target);
                  else if (a.type === "guide") onOpenGuide(a.id);
                  else navigate(ROUTES.map);
                }}
              >
                {s.action.label} →
              </button>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
