import { Link } from "react-router";
import { SiteLayout } from "../../components/layout/SiteLayout";
import { ROUTES, SITE } from "../../services/config/site";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";

export function NotFound() {
  useDocumentTitle("냥집사 — 페이지를 찾을 수 없어요");
  return (
    <SiteLayout>
      <section className="section">
        <div className="container section__head">
          <img className="notfound__mascot" src={SITE.characters.sleep} alt="" />
          <h2>페이지를 찾을 수 없어요</h2>
          <p>주소가 바뀌었거나 없는 페이지예요.</p>
          <p>
            <Link className="btn btn--primary" to={ROUTES.home}>홈으로</Link>
          </p>
        </div>
      </section>
    </SiteLayout>
  );
}
