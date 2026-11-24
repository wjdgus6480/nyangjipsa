// 행정구역 경계 가공: 행정동 GeoJSON(vuski/admdongkor) → 지도용 단계별 파일
//
//   cd 02_frontend/tools && npm install
//   node build-regions.mjs <HangJeongDong_verYYYYMMDD.geojson> <출력 폴더(보통 ../map-poc/regions)>
//
// 출력
//   sido.json          시도 (행정동을 시도 코드로 합침)
//   sigungu.json       시군구 (행정동을 5자리 시군구 코드로 합침, 일반구 단위). 하위 파일 색인 역할도 함(bbox)
//   emd/<시군구코드>.json 읍면동 (번호 동은 합침, 시군구별로 나눔 → 화면에 걸친 시군구만 불러옴)
//   meta.json          원본 버전·건수·생성 시각
//
// 각 구역 속성: code, name, full(전체 이름), parent(상위 코드), lx/ly(라벨 위치 = 폴리곤 내부점),
//              bbox[minLon,minLat,maxLon,maxLat], area(㎡, 라벨 우선순위용)
// 출처 표기 의무: 통계청 SGIS(공공누리 1유형) 가공 vuski/admdongkor(CC BY 4.0) — 04_docs/05 참고
import fs from "node:fs";
import path from "node:path";
import mapshaper from "mapshaper";

const [, , input, outDir] = process.argv;
if (!input || !outDir) {
  console.error("사용법: node build-regions.mjs <행정동.geojson> <출력 폴더>");
  process.exit(1);
}

// 단순화 간격(m): 그 단계를 보는 줌에서 눈에 안 띄는 만큼만 점을 줄임
const LEVELS = {
  sido: { interval: 400, precision: 0.0001 },
  sigungu: { interval: 120, precision: 0.00005 },
  emd: { interval: 25, precision: 0.00001 },
};

// 공통 속성 계산 (mapshaper -each 식)
const COMMON =
  "lx=+this.innerX.toFixed(5), ly=+this.innerY.toFixed(5), " +
  "bbox=this.bounds.map(v => +v.toFixed(5)), area=Math.round(this.area)";

const q = (p) => JSON.stringify(path.resolve(p));

async function run(cmd) {
  await mapshaper.runCommands(cmd);
}

async function main() {
  const out = path.resolve(outDir);
  fs.rmSync(path.join(out, "emd"), { recursive: true, force: true });
  fs.mkdirSync(path.join(out, "emd"), { recursive: true });
  const tmp = fs.mkdtempSync(path.join(out, ".tmp-"));

  // 1) 시도
  await run(
    `-i ${q(input)} snap name=sido ` +
      `-dissolve sido copy-fields=sidonm ` +
      `-simplify interval=${LEVELS.sido.interval} keep-shapes ` +
      `-each "code=sido, name=sidonm, full=sidonm, parent=null, ${COMMON}" ` +
      `-filter-fields code,name,full,parent,lx,ly,bbox,area ` +
      `-o ${q(path.join(out, "sido.json"))} format=geojson precision=${LEVELS.sido.precision}`,
  );

  // 2) 시군구 (일반구 "수원시장안구" → "수원시 장안구")
  await run(
    `-i ${q(input)} snap name=sigungu ` +
      `-dissolve sgg copy-fields=sido,sidonm,sggnm ` +
      `-simplify interval=${LEVELS.sigungu.interval} keep-shapes ` +
      `-each "code=sgg, name=sggnm.replace(/^(.+시)(.+구)$/, '$1 $2'), full=sidonm + ' ' + sggnm.replace(/^(.+시)(.+구)$/, '$1 $2'), parent=sido, ${COMMON}" ` +
      `-filter-fields code,name,full,parent,lx,ly,bbox,area ` +
      `-o ${q(path.join(out, "sigungu.json"))} format=geojson precision=${LEVELS.sigungu.precision}`,
  );

  // 3) 읍면동 → 시군구별 파일
  //    번호로 나뉜 행정동은 하나로 합침: 우1동·우2동·우3동 → 우동, 종로1·2·3·4가동 → 종로동 (읍·면, 번호 없는 동은 그대로)
  //    합친 구역 코드는 묶인 행정동 코드 중 가장 작은 값
  await run(
    `-i ${q(input)} snap name=emd ` +
      `-each "short=adm_nm.split(' ').pop(), mname=short.replace(/[0-9·.,]+가?동$/, '동')" ` +
      `-dissolve sgg,mname copy-fields=sidonm,sggnm calc="code=min(adm_cd2), merged=count()" ` +
      `-simplify interval=${LEVELS.emd.interval} keep-shapes ` +
      `-each "name=mname, full=sidonm + ' ' + sggnm + ' ' + mname, parent=sgg, split_key=sgg, ${COMMON}" ` +
      `-split split_key ` +
      `-filter-fields code,name,full,parent,lx,ly,bbox,area ` +
      `-o ${q(tmp + path.sep)} format=geojson precision=${LEVELS.emd.precision}`,
  );
  // 출력 이름(레이어명-값.json 등)을 <시군구코드>.json 으로 맞춤
  let emdFiles = 0;
  for (const f of fs.readdirSync(tmp)) {
    const fc = JSON.parse(fs.readFileSync(path.join(tmp, f), "utf8"));
    const code = fc.features[0]?.properties.parent;
    if (!code) continue;
    fs.writeFileSync(path.join(out, "emd", `${code}.json`), JSON.stringify(fc));
    emdFiles++;
  }
  fs.rmSync(tmp, { recursive: true, force: true });

  // 4) 메타
  const count = (f) => JSON.parse(fs.readFileSync(path.join(out, f), "utf8")).features.length;
  const meta = {
    source: path.basename(input),
    attribution:
      "통계청 SGIS(공공누리 제1유형) 행정동 경계 가공: vuski/admdongkor (CC BY 4.0) — https://github.com/vuski/admdongkor",
    built_at: new Date().toISOString(),
    counts: { sido: count("sido.json"), sigungu: count("sigungu.json"), emd_files: emdFiles },
    simplify_interval_m: Object.fromEntries(Object.entries(LEVELS).map(([k, v]) => [k, v.interval])),
  };
  fs.writeFileSync(path.join(out, "meta.json"), JSON.stringify(meta, null, 2));
  console.log(meta);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
