import { useEffect, useRef } from 'react'
import { ANALYSIS_STEPS } from '../../data/prototype'

const STEP_KEYS = [
  'SIMILAR_FESTIVAL',
  'TREND_FIT',
  'DEMAND_FIT',
  'COMPETITION_RISK',
  'WEATHER_RISK',
  'TOURISM_LINKAGE',
  'FINALIZING',
]

export const STEP_LABELS = {
  SIMILAR_FESTIVAL: ANALYSIS_STEPS[0],
  TREND_FIT: ANALYSIS_STEPS[1],
  DEMAND_FIT: ANALYSIS_STEPS[2],
  COMPETITION_RISK: ANALYSIS_STEPS[3],
  WEATHER_RISK: ANALYSIS_STEPS[4],
  TOURISM_LINKAGE: ANALYSIS_STEPS[5],
  FINALIZING: '분석 결과 종합 중',
}

const getStepIndex = (step) => STEP_KEYS.indexOf(step)

export function LoadingScreen({
  plan,
  onDone,
  onRetry,
  analysisProgress = null,
  isComplete = false,
  isFailed = false,
}) {
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  useEffect(() => {
    if (!isComplete) return undefined
    const timer = setTimeout(() => onDoneRef.current(), 380)
    return () => clearTimeout(timer)
  }, [isComplete])

  const currentIndex = getStepIndex(analysisProgress?.step)
  const active = isComplete
    ? STEP_KEYS.length
    : currentIndex < 0
      ? 0
      : analysisProgress?.status === 'COMPLETED'
        ? Math.min(currentIndex + 1, STEP_KEYS.length)
        : currentIndex

  return (
    <main className="screen active">
      <div className="analysing">
        <h2 className="an-h">
          {plan.name} {isFailed ? '분석 실패' : '분석 중'}
        </h2>
        <p className="an-sub">
          유사 축제·관심도·관광수요·행사 이력·기상 통계·주변 POI를 순서대로
          조회합니다.
        </p>
        <div className="an-list">
          {STEP_KEYS.map((step, index) => (
            <div
              className={`an-item ${
                (isFailed || analysisProgress?.status === 'FAILED') &&
                index === currentIndex
                  ? 'fail'
                  : index < active
                    ? 'fin'
                    : index === currentIndex &&
                        analysisProgress?.status === 'RUNNING' &&
                        !isFailed
                      ? 'run'
                      : ''
              }`}
              key={step}
            >
              <span className="dot" />
              {analysisProgress?.step === step && analysisProgress?.message
                ? analysisProgress.message
                : STEP_LABELS[step]}
            </div>
          ))}
        </div>
        <div className="progbar">
          <i
            style={{
              width: `${Math.min(100, (active / STEP_KEYS.length) * 100)}%`,
            }}
          />
        </div>
        {isFailed && (
          <div className="alert show" role="alert">
            {analysisProgress?.message || '분석 진행 중 문제가 발생했습니다.'}
          </div>
        )}
        {isFailed && onRetry && (
          <button type="button" className="btn btn-primary" onClick={onRetry}>
            분석 다시 시작
          </button>
        )}
      </div>
    </main>
  )
}
