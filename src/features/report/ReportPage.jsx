import { useMemo } from 'react'
import { Button } from '../../components/ui'
import { fmt, levelClass } from '../../utils/formatters'
import { ITEMS, cardData } from '../analysis/analysisData'
import { getDetailHtml } from '../analysis/DetailPanel'

const REPORT_STATUS_LABELS = {
  COMPLETED: '분석 완료',
  FAILED: '분석 실패',
  RUNNING: '분석 중',
  ANALYZING: '분석 중',
  WAITING: '분석 대기',
}

const displayText = (value) => {
  if (value === null || value === undefined) return '-'
  const text = String(value).trim()
  return text && text !== '-' ? text : '-'
}

const parseReportDate = (value) => {
  const text = displayText(value)
  if (text === '-') return null

  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const timestamp = Date.UTC(year, month - 1, day)
  const date = new Date(timestamp)
  if (
    !Number.isFinite(timestamp) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }

  return { label: `${match[1]}-${match[2]}-${match[3]}`, timestamp }
}

const formatReportDate = (value) => parseReportDate(value)?.label || '-'

const formatReportPeriod = (startValue, endValue) => {
  const start = parseReportDate(startValue)
  const end = parseReportDate(endValue)
  if (!start && !end) return '-'

  const range = `${start?.label || '-'} ~ ${end?.label || '-'}`
  if (!start || !end || end.timestamp < start.timestamp) return range

  const days = Math.round((end.timestamp - start.timestamp) / 86400000) + 1
  return `${range} (${days}일)`
}

const formatReportTarget = (value) => {
  if (value === null || value === undefined || value === '') return '-'
  const number = typeof value === 'string'
    ? Number(value.trim().replaceAll(',', '').replace(/명$/, ''))
    : Number(value)
  return Number.isFinite(number) ? fmt(number) : '-'
}

const formatReportStatus = (value) => {
  const status = displayText(value)
  if (status === '-') return '-'
  return REPORT_STATUS_LABELS[status.toUpperCase()] || status
}

export function ReportScreen({ A, onBack, onPrint, backLabel = '결과로 돌아가기' }) {
  const displayPlan = A.reportPlan ?? A.p ?? {}
  const displayFestivalName = A.reportPlan
    ? displayText(A.server?.festivalName)
    : displayText(A.p?.name)
  const displayPeriod = formatReportPeriod(displayPlan.start, displayPlan.end)
  const displayTarget = formatReportTarget(displayPlan.target)
  const displayStatus = formatReportStatus(A.server?.analysisStatus)
  const displayCreatedAt = formatReportDate(A.server?.createdAt)
  const cards = ITEMS.map((item) => ({ item, data: cardData(item, A, { report: true }) }))
  const recommendations = useMemo(() => {
    let normalizedRecommendations

    if (A.report?.hasRecommendations) {
      normalizedRecommendations = (A.report.recommendations || []).map((recommendation, i) => ({
        source:
          recommendation.source ??
          (ITEMS.find((item) => item.key === recommendation.itemType)?.name ||
            '평가 항목'),
        title: recommendation.t,
        text: recommendation.d,
        priority: recommendation.p ?? 3,
        i,
      }))
    } else {
      const doc = new DOMParser().parseFromString(
        ITEMS.map((item) => getDetailHtml(item, A)).join(''),
        'text/html',
      )
      normalizedRecommendations = [...doc.querySelectorAll('.rec')].map((el, i) => ({
        source:
          ITEMS.find((item) =>
            getDetailHtml(item, A).includes(
              el.querySelector('b')?.textContent || '',
            ),
          )?.name || '평가 항목',
        title: el.querySelector('b')?.textContent || '',
        text: el.querySelector('p')?.textContent || '',
        priority:
          el.querySelector('.pri')?.className.match(/p([123])/)?.[1] * 1 || 3,
        i,
      }))
    }

    return normalizedRecommendations.sort(
      (a, b) => a.priority - b.priority || a.i - b.i,
    )
  }, [A])
  return (
    <main className="screen active">
      <div className="wrap">
        <div className="plan-bar noprint">
          <div>
            <div className="plan-title">최종 리포트</div>
            <div className="plan-meta">
              6개 평가 항목의 판단과 권장 수정사항을 한 장으로 정리했습니다.
            </div>
          </div>
          <span className="spacer" />
          <Button small onClick={onBack}>
            {backLabel}
          </Button>
          <Button small primary onClick={onPrint}>
            인쇄 / PDF 저장
          </Button>
        </div>
        <div className="rpt">
          <div className="rpt-head">
            <div>
              <div className="lbl">축제 기획 타당성 분석 리포트</div>
              <h2 className="report-title">{displayFestivalName}</h2>
              <div className="plan-meta">
                {displayText(displayPlan.org)}
                <i>|</i>
                {displayText(displayPlan.venue)}
                <i>|</i>
                {displayPeriod}<i>|</i>목표 {displayTarget === '-' ? '-' : `${displayTarget}명`}
                <i>|</i>{displayStatus}
                <i>|</i>{displayCreatedAt}
              </div>
            </div>
            <div className="report-score">
              <div className="lbl">기획 타당성 점수</div>
              <b>{A.composite}</b>
              <div className="lbl">
                등급 {A.grade} · {A.gradeNote}
              </div>
            </div>
          </div>
          <ReportGroup
            title="기획 타당성 점수 반영 항목"
            tag="3개 항목 동일 가중"
            cards={cards.filter((x) => x.item.scored)}
          />
          <ReportGroup
            title="별도 진단"
            tag="기획 타당성 점수 미반영"
            cards={cards.filter((x) => !x.item.scored)}
          />
          <section className="rpt-sec">
            <h3>권장 수정사항 {recommendations.length}건</h3>
            <div className="rpt-list">
              {recommendations.map((r) => (
                <div className="rpt-row" key={`${r.source}-${r.title}-${r.i}`}>
                  <div>
                    <span className={`pri p${r.priority}`}>
                      {r.priority === 1
                        ? '즉시 반영'
                        : r.priority === 2
                          ? '검토'
                          : '선택'}
                    </span>
                  </div>
                  <div>
                    <b>{r.title}</b>
                    <p>{r.text}</p>
                    <div className="src">{r.source}</div>
                  </div>
                </div>
              ))}
            </div>
          </section>
          <section className="rpt-sec">
            <p className="note report-note">
              이 리포트는 유사 축제·검색 관심도·지역 관광수요·행사 이력·기상
              통계·주변 POI의 과거 데이터를 근거로 한 타당성 및 리스크
              진단입니다. 미래 흥행을 보장하지 않으며, 입력 정보가 변경되면
              결과도 달라집니다. 본 화면은 예시 데이터로 동작하는
              프로토타입입니다.
            </p>
          </section>
        </div>
      </div>
    </main>
  )
}
export function ReportLoadingScreen() {
  return (
    <main className="screen active">
      <div className="wrap">
        <section className="formcard" role="status" aria-live="polite">
          <strong>최종 리포트를 불러오는 중입니다.</strong>
        </section>
      </div>
    </main>
  )
}

export function ReportErrorScreen({ error, notFound = false, onBack }) {
  return (
    <main className="screen active">
      <div className="wrap">
        <section className="formcard" role="alert">
          <strong>{notFound ? '분석 결과를 찾을 수 없습니다.' : '최종 리포트를 불러오지 못했습니다.'}</strong>
          <p>{error || '진입 경로를 확인하고 다시 시도해 주세요.'}</p>
          <Button small onClick={onBack}>결과로 돌아가기</Button>
        </section>
      </div>
    </main>
  )
}

function ReportGroup({ title, tag, cards }) {
  return (
    <section className="rpt-sec">
      <h3>
        {title}{' '}
        <span
          className="tag"
          style={{ fontWeight: 400, fontSize: '11.5px', color: 'var(--muted)' }}
        >
          {tag}
        </span>
      </h3>
      <div className="rpt-grid">
        {cards.map(({ item, data }) => (
          <div className="rpt-item" key={item.key}>
            <div className="t">
              <b>{data.title ?? item.name}</b>
              <span className={levelClass(data.tone)}>{data.pill}</span>
            </div>
            <div className="report-metric">
              {data.metric} <span>{data.unit}</span>
            </div>
            {data.sub?.length > 0 && (
              <div className="src">
                {data.sub.map(([label, value], index) => (
                  <span key={label}>
                    {index > 0 ? ' · ' : ''}
                    {label}: {value}
                  </span>
                ))}
              </div>
            )}
            {data.chart?.highlightLabel !== null && data.chart?.highlightLabel !== undefined && (
              <div className="src">{data.chart.highlightLabel}</div>
            )}
            <p>{data.read}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
