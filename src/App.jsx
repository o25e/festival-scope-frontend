import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { analyze, SAMPLE } from './data/prototype'
import { createFestivalPlan, getFestivalPlanId } from './api/festivalPlans'
import {
  executeFestivalPlanAnalysis,
  getAnalysis,
  getAnalysisId,
  getAnalysisReport,
  getConflictRiskAnalysis,
  getDemandFitAnalysis,
  getTargetVisitorAnalysis,
  getTourismLinkageAnalysis,
  getTrendFitAnalysis,
  getWeatherRiskAnalysis,
  streamAnalysisProgress,
} from './api/analyses'
import { ApiError } from './api/http'
import { Header } from './components/AppHeader'
import { useAuth } from './auth/AuthProvider'
import { LoginModal } from './features/auth/LoginModal'
import { LandingPage } from './features/landing/LandingPage'
import { FormScreen } from './features/input/InputPage'
import { ReviewScreen } from './features/review/ReviewPage'
import { LoadingScreen } from './features/loading/LoadingPage'
import { ITEMS } from './features/analysis/analysisData'
import {
  ResultErrorScreen,
  ResultLoadingScreen,
  ResultScreen,
} from './features/analysis/ResultsPage'
import { Panel } from './features/analysis/DetailPanel'
import {
  ReportErrorScreen,
  ReportLoadingScreen,
  ReportScreen,
} from './features/report/ReportPage'
import { DocumentsPage } from './features/documents/DocumentsPage'
import { buildFestivalPlanPayload } from './features/input/festivalPlanPayload'
import {
  mergeParsedFestivalPlan,
  normalizeFestivalPlan,
} from './features/input/festivalPlanParser'
import { navigate, useRoute } from './routing'
import {
  mergeAnalysisReport,
  mergeServerAnalysis,
} from './features/analysis/serverAnalysis'

const EMPTY_PLAN = {
  planName: '',
  name: '',
  org: '',
  festivalThemes: [{ type: '', topic: '' }],
  target: 0,
  eventType: 'new',
  firstHeldYear: null,
  sido: '강원',
  sigungu: '영월군',
  venueType: 'outdoor',
  venue: '',
  venueLocation: null,
  maxCapacity: null,
  start: '',
  end: '',
  programs: [],
  programNames: [],
  programCandidates: [],
  customProgramNames: [],
}

const hasReportValue = (value) => {
  if (value === null || value === undefined) return false
  const text = String(value).trim()
  return text !== '' && text !== '-'
}

const firstReportValue = (...values) => values.find(hasReportValue) ?? null

const reportNumber = (value) => {
  if (!hasReportValue(value)) return null
  const normalized = typeof value === 'string'
    ? value.trim().replaceAll(',', '').replace(/명$/, '')
    : value
  const number = Number(normalized)
  return Number.isFinite(number) ? number : null
}

const firstReportNumber = (...values) => {
  for (const value of values) {
    const number = reportNumber(value)
    if (number !== null) return number
  }
  return null
}

const reportRegion = (source = {}) => {
  const directRegion = firstReportValue(source.hostRegion)
  if (directRegion) return directRegion

  const parts = [source.sido, source.sigungu].filter(hasReportValue)
  return parts.length ? parts.join(' ') : null
}

const buildReportDisplayPlan = (summary = {}, document = null, report = {}) => {
  const documentPlan = document?.plan && typeof document.plan === 'object'
    ? document.plan
    : {}
  const targetSummaryItem = Array.isArray(summary.items)
    ? summary.items.find((item) => item?.itemType === 'TARGET_VISITOR')
    : null
  const targetDetail = report?.details?.TARGET_VISITOR
  const targetVisitor = targetDetail?.targetVisitor && typeof targetDetail.targetVisitor === 'object'
    ? targetDetail.targetVisitor
    : targetDetail || {}
  const summaryRegion = reportRegion(summary)
  const documentRegion = reportRegion(document || {})
  const planRegion = reportRegion(documentPlan)

  return {
    name: firstReportValue(summary.festivalName, document?.festivalName, documentPlan.name),
    org: firstReportValue(summaryRegion, documentRegion, planRegion, documentPlan.org),
    venue: firstReportValue(
      summary.venueName,
      document?.venueName,
      documentPlan.venueName,
      documentPlan.venue,
    ),
    start: firstReportValue(
      summary.festivalStartDate,
      summary.startDate,
      document?.festivalStartDate,
      document?.startDate,
      documentPlan.festivalStartDate,
      documentPlan.startDate,
      documentPlan.start,
    ),
    end: firstReportValue(
      summary.festivalEndDate,
      summary.endDate,
      document?.festivalEndDate,
      document?.endDate,
      documentPlan.festivalEndDate,
      documentPlan.endDate,
      documentPlan.end,
    ),
    target: firstReportNumber(
      summary.targetVisitorCount,
      targetSummaryItem?.targetVisitorCount,
      targetVisitor.targetVisitorCount,
      document?.targetVisitorCount,
      documentPlan.targetVisitorCount,
      documentPlan.target,
    ),
  }
}

const ANALYSIS_ITEM_TYPES = [
  'TARGET_VISITOR',
  'TREND_FIT',
  'DEMAND_FIT',
  'CONFLICT_RISK',
  'WEATHER_RISK',
  'TOURISM_LINKAGE',
]

const ANALYSIS_DETAIL_GETTERS = {
  TARGET_VISITOR: getTargetVisitorAnalysis,
  TREND_FIT: getTrendFitAnalysis,
  DEMAND_FIT: getDemandFitAnalysis,
  CONFLICT_RISK: getConflictRiskAnalysis,
  WEATHER_RISK: getWeatherRiskAnalysis,
  TOURISM_LINKAGE: getTourismLinkageAnalysis,
}

const loadServerAnalysisData = async (analysisId, options = {}) => {
  const response = await getAnalysis(analysisId, options)
  const summary = Array.isArray(response?.items)
    ? response
    : response?.summary && typeof response.summary === 'object'
      ? response.summary
      : response
  if (!summary || typeof summary !== 'object' || !Array.isArray(summary.items)) {
    throw new ApiError('분석 결과 요약 데이터 형식이 올바르지 않습니다.', { data: response })
  }
  const supportedItemTypes = ANALYSIS_ITEM_TYPES.filter((itemType) =>
    summary?.items?.some((item) => item?.itemType === itemType),
  )
  const detailEntries = await Promise.all(
    supportedItemTypes.map(async (itemType) => [
      itemType,
      await ANALYSIS_DETAIL_GETTERS[itemType](analysisId, options),
    ]),
  )

  return { summary, details: Object.fromEntries(detailEntries) }
}

const buildAnalysisPlan = (summary = {}, document = null) => {
  const documentPlan = document?.plan && typeof document.plan === 'object'
    ? document.plan
    : {}
  const targetSummaryItem = Array.isArray(summary.items)
    ? summary.items.find((item) => item?.itemType === 'TARGET_VISITOR')
    : null
  const targetDetail = targetSummaryItem?.targetVisitor || {}
  const summaryRegion = reportRegion(summary)
  const documentRegion = reportRegion(document || {})

  return normalizeFestivalPlan({
    ...EMPTY_PLAN,
    ...documentPlan,
    planName: firstReportValue(
      summary.festivalName,
      document?.festivalName,
      documentPlan.planName,
      documentPlan.name,
    ) || EMPTY_PLAN.planName,
    name: firstReportValue(
      summary.festivalName,
      document?.festivalName,
      documentPlan.name,
      documentPlan.planName,
    ) || EMPTY_PLAN.name,
    org: firstReportValue(summaryRegion, documentRegion, documentPlan.org) || EMPTY_PLAN.org,
    sido: firstReportValue(summary.sido, documentPlan.sido) || EMPTY_PLAN.sido,
    sigungu: firstReportValue(summary.sigungu, documentPlan.sigungu) || EMPTY_PLAN.sigungu,
    venue: firstReportValue(
      summary.venueName,
      document?.venueName,
      documentPlan.venue,
      documentPlan.venueName,
    ) || EMPTY_PLAN.venue,
    start: firstReportValue(
      summary.festivalStartDate,
      summary.startDate,
      document?.festivalStartDate,
      document?.startDate,
      documentPlan.start,
      documentPlan.festivalStartDate,
      documentPlan.startDate,
    ) || EMPTY_PLAN.start,
    end: firstReportValue(
      summary.festivalEndDate,
      summary.endDate,
      document?.festivalEndDate,
      document?.endDate,
      documentPlan.end,
      documentPlan.festivalEndDate,
      documentPlan.endDate,
    ) || EMPTY_PLAN.end,
    target: firstReportNumber(
      summary.targetVisitorCount,
      targetSummaryItem?.targetVisitorCount,
      targetDetail.targetVisitorCount,
      document?.targetVisitorCount,
      documentPlan.targetVisitorCount,
      documentPlan.target,
    ) ?? EMPTY_PLAN.target,
  })
}

const LOGIN_INVALID_CREDENTIALS_MESSAGE =
  '이메일 또는 비밀번호가 올바르지 않습니다.'
const LOGIN_SERVER_ERROR_MESSAGE =
  '로그인 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.'
const LOGIN_NETWORK_ERROR_MESSAGE = '네트워크 오류가 발생했습니다.'
const LOGIN_VALIDATION_ERROR_CODE = 'VALIDATION_001'
const LOGIN_INVALID_CREDENTIALS_ERROR_CODE = 'AUTH_002'

const getLoginErrorCode = (error) => {
  const candidates = [
    error?.code,
    error?.data?.errorCode,
    error?.data?.error_code,
    error?.data?.code,
    error?.data?.error?.errorCode,
    error?.data?.error?.error_code,
    error?.data?.error?.code,
  ]

  const code = candidates.find(
    (candidate) => typeof candidate === 'string' && candidate.trim(),
  )
  return code ? code.trim().toUpperCase().replace(/[\s-]+/g, '_') : null
}

const getLoginValidationErrorMessage = (error) => {
  if (getLoginErrorCode(error) !== LOGIN_VALIDATION_ERROR_CODE) return null

  const validationData = error?.data?.data
  if (validationData && typeof validationData === 'object') {
    if (Object.prototype.hasOwnProperty.call(validationData, 'email')) {
      return '올바른 형식의 이메일 주소를 입력해주세요.'
    }
    if (Object.prototype.hasOwnProperty.call(validationData, 'password')) {
      return '비밀번호를 입력해주세요.'
    }
  }

  return '입력 정보를 확인해주세요.'
}

const isInvalidCredentialError = (error) => {
  const errorCode = getLoginErrorCode(error)
  return (
    errorCode === LOGIN_INVALID_CREDENTIALS_ERROR_CODE ||
    (!errorCode && error?.status === 401)
  )
}

const getLoginErrorMessage = (error) => {
  if (error?.status === 0 && error?.cause) {
    return LOGIN_NETWORK_ERROR_MESSAGE
  }
  const validationErrorMessage = getLoginValidationErrorMessage(error)
  if (validationErrorMessage) return validationErrorMessage
  if (isInvalidCredentialError(error)) {
    return LOGIN_INVALID_CREDENTIALS_MESSAGE
  }
  return LOGIN_SERVER_ERROR_MESSAGE
}

export default function App() {
  const { isAuthenticated, isPending, login, signup, logout } = useAuth()
  const route = useRoute()
  const initialStage = route.name === 'documents'
    ? 'documents'
    : route.name === 'input'
      ? 'input'
      : route.name === 'analysis'
        ? 'result'
        : route.name === 'report'
          ? 'report'
          : isAuthenticated
            ? 'documents'
            : 'landing'
  const [stage, setStage] = useState(initialStage),
    [loginOpen, setLoginOpen] = useState(false),
    [loginError, setLoginError] = useState(''),
    [isSample, setIsSample] = useState(false),
    [step, setStep] = useState(1),
    [plan, setPlan] = useState(EMPTY_PLAN),
    [documents, setDocuments] = useState([]),
    [activeDocument, setActiveDocument] = useState(null),
    [analysis, setAnalysis] = useState(null),
    [reportState, setReportState] = useState({
      status: 'idle',
      analysis: null,
      error: null,
    }),
    [resultState, setResultState] = useState({
      status: 'idle',
      error: null,
    }),
    [openKey, setOpenKey] = useState(null),
    [isRegisteringPlan, setIsRegisteringPlan] = useState(false),
    [registrationError, setRegistrationError] = useState(''),
    [festivalPlanResponse, setFestivalPlanResponse] = useState(null),
    [registeredPlanId, setRegisteredPlanId] = useState(null),
    [registeredAnalysisId, setRegisteredAnalysisId] = useState(null),
    [isAnalysisComplete, setIsAnalysisComplete] = useState(false),
    [analysisProgress, setAnalysisProgress] = useState(null),
    [isAnalysisFailed, setIsAnalysisFailed] = useState(false),
    [autoFilledFields, setAutoFilledFields] = useState({})
  const registrationInFlightRef = useRef(false)
  const analysisStreamControllerRef = useRef(null)
  const planRef = useRef(plan)
  planRef.current = plan
  const cancelAnalysisStream = () => {
    analysisStreamControllerRef.current?.abort()
    analysisStreamControllerRef.current = null
  }

  useEffect(() => cancelAnalysisStream, [])
  const A = useMemo(
      () =>
        analysis ||
        (stage === 'report' ? analyze(plan) : null),
      [analysis, plan, stage],
    ),
    index = ITEMS.findIndex((x) => x.key === openKey),
    openItem = index >= 0 ? { ...ITEMS[index], index } : null

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [stage, step])

  const handleDocumentsLoaded = useCallback((nextDocuments) => {
    setDocuments(nextDocuments)
  }, [])

  useEffect(() => {
    if (isAuthenticated) {
      if (isSample) return
      if (route.name === 'documents') {
        if (stage !== 'documents') setStage('documents')
        return
      }
      if (route.name === 'input') {
        if (stage === 'landing' || stage === 'documents') setStage('input')
        return
      }
      if (route.name === 'analysis') {
        if (stage !== 'result') setStage('result')
        return
      }
      if (route.name === 'report') {
        const document =
          String(activeDocument?.analysisId) === route.analysisId
            ? activeDocument
            : documents.find((item) => String(item.analysisId) === route.analysisId)
        if (document && stage !== 'report') {
          const reportPlan = normalizeFestivalPlan(
            document.plan || {
              ...EMPTY_PLAN,
              planName: document.festivalName,
              name: document.festivalName,
              org: document.hostRegion,
            },
          )
          setPlan(reportPlan)
          setAutoFilledFields({})
          setAnalysis(document.analysis || (document.plan ? analyze(reportPlan) : null))
          setStage('report')
        } else if (!document && stage !== 'report') {
          setPlan(EMPTY_PLAN)
          setAutoFilledFields({})
          setAnalysis(null)
          setStage('report')
        }
        return
      }
      navigate('/documents', { replace: true })
      return
    }
    if (!isSample) {
      if (route.name !== 'landing') navigate('/', { replace: true })
      if (stage !== 'landing') setStage('landing')
    }
  }, [activeDocument, documents, isAuthenticated, isSample, route.analysisId, route.name, stage])

  useEffect(() => {
    if (!isAuthenticated || isSample || route.name !== 'report' || !route.analysisId) return undefined

    const controller = new AbortController()
    let active = true
    setReportState({ status: 'loading', analysis: null, error: null })

    Promise.resolve()
      .then(() => getAnalysisReport(route.analysisId, { signal: controller.signal }))
      .then(async (response) => ({
        response,
        tourismLinkageDetail: await getTourismLinkageAnalysis(route.analysisId, {
          signal: controller.signal,
        }),
      }))
      .then(({ response, tourismLinkageDetail }) => {
        if (!active) return
        const reportSummary = response?.summary || {}
        const reportName = reportSummary.festivalName
        const reportDocument =
          String(activeDocument?.analysisId) === route.analysisId
            ? activeDocument
            : documents.find((item) => String(item.analysisId) === route.analysisId)
        const currentPlan = planRef.current
        const reportPlan = normalizeFestivalPlan({
          ...currentPlan,
          ...(reportName === null || reportName === undefined
            ? {}
            : { planName: reportName, name: reportName }),
        })
        const basePlan =
          reportPlan.start && reportPlan.end
            ? reportPlan
            : normalizeFestivalPlan({ ...SAMPLE, ...reportPlan })
        const reportWithTourismLinkageDetail = {
          ...response,
          details: {
            ...(response?.details || {}),
            TOURISM_LINKAGE: tourismLinkageDetail,
          },
        }
        const nextAnalysis = {
          ...mergeAnalysisReport(
            analyze(basePlan),
            reportWithTourismLinkageDetail,
          ),
          reportPlan: buildReportDisplayPlan(reportSummary, reportDocument, response),
        }
        setPlan(reportPlan)
        setAnalysis(nextAnalysis)
        setReportState({ status: 'success', analysis: nextAnalysis, error: null })
      })
      .catch((error) => {
        if (!active || error?.name === 'AbortError' || error?.cause?.name === 'AbortError') return
        setReportState({
          status: error?.status === 404 ? 'not-found' : 'error',
          analysis: null,
          error: error?.message || '최종 리포트를 불러오지 못했습니다.',
        })
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [activeDocument, documents, isAuthenticated, isSample, route.analysisId, route.name])

  useEffect(() => {
    if (!isAuthenticated || isSample || route.name !== 'analysis' || !route.analysisId) {
      return undefined
    }

    const currentAnalysisId = analysis?.server?.analysisId
    if (String(currentAnalysisId) === route.analysisId) {
      setResultState({ status: 'success', error: null })
      return undefined
    }

    const controller = new AbortController()
    let active = true
    const document =
      String(activeDocument?.analysisId) === route.analysisId
        ? activeDocument
        : documents.find((item) => String(item.analysisId) === route.analysisId)

    setResultState({ status: 'loading', error: null })
    setOpenKey(null)
    setAnalysis(null)

    Promise.resolve()
      .then(() => loadServerAnalysisData(route.analysisId, { signal: controller.signal }))
      .then(({ summary, details }) => {
        if (!active) return
        const resultPlan = buildAnalysisPlan(summary, document)
        const nextAnalysis = mergeServerAnalysis(analyze(resultPlan), summary, details)
        setPlan(resultPlan)
        setAnalysis(nextAnalysis)
        setResultState({ status: 'success', error: null })
      })
      .catch((error) => {
        if (!active || error?.name === 'AbortError' || error?.cause?.name === 'AbortError') return
        setResultState({
          status: error?.status === 404 ? 'not-found' : 'error',
          error: error?.message || '분석 결과를 불러오지 못했습니다.',
        })
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [activeDocument, analysis, documents, isAuthenticated, isSample, route.analysisId, route.name])

  useEffect(() => {
    const f = (e) => {
      if (e.key === 'Escape') setOpenKey(null)
      if (index >= 0 && e.key === 'ArrowLeft' && index > 0)
        setOpenKey(ITEMS[index - 1].key)
      if (index >= 0 && e.key === 'ArrowRight' && index < ITEMS.length - 1)
        setOpenKey(ITEMS[index + 1].key)
    }
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [index])

  const openDocuments = () => {
      cancelAnalysisStream()
      setOpenKey(null)
      setIsSample(false)
      setActiveDocument(null)
      setStage(isAuthenticated ? 'documents' : 'landing')
      setStep(1)
      setAnalysis(null)
      setRegistrationError('')
      setFestivalPlanResponse(null)
      setRegisteredPlanId(null)
      setRegisteredAnalysisId(null)
      setIsAnalysisComplete(false)
      setAnalysisProgress(null)
      setIsAnalysisFailed(false)
      navigate(isAuthenticated ? '/documents' : '/')
    },
    home = openDocuments,
    startNewPlan = () => {
      cancelAnalysisStream()
      setOpenKey(null)
      setIsSample(false)
      setActiveDocument(null)
      setPlan(EMPTY_PLAN)
      setAutoFilledFields({})
      setAnalysis(null)
      setStep(1)
      setRegistrationError('')
      setFestivalPlanResponse(null)
      setRegisteredPlanId(null)
      setRegisteredAnalysisId(null)
      setIsAnalysisComplete(false)
      setAnalysisProgress(null)
      setIsAnalysisFailed(false)
      setStage('input')
      navigate('/plans/new')
    },
    goEdit = () => {
      cancelAnalysisStream()
      setOpenKey(null)
      setStep(1)
      setRegistrationError('')
      setFestivalPlanResponse(null)
      setRegisteredPlanId(null)
      setRegisteredAnalysisId(null)
      setIsAnalysisComplete(false)
      setAnalysisProgress(null)
      setIsAnalysisFailed(false)
      setStage('input')
      navigate('/plans/new')
    },
    finish = () => {
      const id = registeredAnalysisId
      if (!id || !analysis) {
        setIsAnalysisComplete(false)
        setRegistrationError('분석 결과를 확인하지 못했습니다. 다시 시도해주세요.')
        setStage('review')
        return
      }
      const document = {
        analysisId: id,
        festivalName: plan.planName || plan.name || '새 축제 기획안',
        hostRegion: plan.org || [plan.sido, plan.sigungu].filter(Boolean).join(' ') || '—',
        plan,
        analysis,
      }
      setActiveDocument(document)
      setResultState({ status: 'success', error: null })
      setStage('result')
      navigate(`/analyses/${encodeURIComponent(id)}`)
    }

  const handleParsedPlan = ({ response }) => {
    const parsed = mergeParsedFestivalPlan(EMPTY_PLAN, response)
    if (!parsed.hasValues) return

    setPlan(parsed.plan)
    setAutoFilledFields(parsed.autoFilledFields || {})
      setActiveDocument(null)
    setAnalysis(null)
    setStep(1)
    setRegistrationError('')
    setFestivalPlanResponse(null)
    setRegisteredPlanId(null)
    setRegisteredAnalysisId(null)
    setIsAnalysisComplete(false)
    setAnalysisProgress(null)
    setIsAnalysisFailed(false)
    setStage('input')
    navigate('/plans/new')
  }

  const handleAnalyze = async () => {
    if (registrationInFlightRef.current) return

    registrationInFlightRef.current = true
    setIsRegisteringPlan(true)
    setRegistrationError('')
    let phase = 'registration'
    const analysisController = new AbortController()
    analysisStreamControllerRef.current = analysisController

    try {
      const payload = buildFestivalPlanPayload(plan)
      const response = await createFestivalPlan(payload, {
        signal: analysisController.signal,
      })
      const planId = getFestivalPlanId(response)
      if (!planId) {
        throw new ApiError('기획안 등록 응답에서 planId를 확인하지 못했습니다.', {
          data: response,
        })
      }

      setFestivalPlanResponse(response)
      setRegisteredPlanId(planId)
      setRegisteredAnalysisId(null)
      setAnalysis(null)
      setIsAnalysisComplete(false)
      setAnalysisProgress(null)
      setIsAnalysisFailed(false)
      setStage('loading')
      phase = 'analysis-execution'
      const executionResponse = await executeFestivalPlanAnalysis(planId, {
        signal: analysisController.signal,
      })
      const analysisId = getAnalysisId(executionResponse)
      if (!analysisId) {
        throw new ApiError('분석 실행 응답에서 analysisId를 확인하지 못했습니다.', {
          data: executionResponse,
        })
      }
      setRegisteredAnalysisId(analysisId)

      phase = 'analysis-progress'
      const terminalProgress = await streamAnalysisProgress(analysisId, {
        signal: analysisController.signal,
        onProgress: (progress) => {
          setAnalysisProgress(progress)
          if (progress.step === 'ANALYSIS' && progress.status === 'FAILED') {
            setIsAnalysisFailed(true)
          }
        },
      })
      if (terminalProgress?.status === 'FAILED') {
        setIsAnalysisFailed(true)
        return
      }

      phase = 'analysis-summary'
      const { summary, details } = await loadServerAnalysisData(analysisId, {
        signal: analysisController.signal,
      })
      const serverAnalysis = mergeServerAnalysis(analyze(plan), summary, details)
      setAnalysis(serverAnalysis)
      setIsAnalysisComplete(true)
      setIsAnalysisFailed(false)
    } catch (error) {
      if (error?.name === 'AbortError' || error?.cause?.name === 'AbortError') {
        return
      }

      if (phase === 'analysis-progress') {
        setAnalysisProgress((previous) => ({
          ...(previous || {}),
          step: previous?.step || 'ANALYSIS',
          status: 'FAILED',
          message:
            error?.message ||
            '분석 진행 중 문제가 발생했습니다.',
        }))
        setIsAnalysisFailed(true)
        setStage('loading')
        return
      }

      setRegistrationError(
        error?.message || '축제 기획안 등록에 실패했습니다. 다시 시도해주세요.',
      )
      if (phase === 'analysis-execution' && error?.status === 404) {
        setRegistrationError('등록된 축제 기획안을 찾을 수 없습니다. 다시 시도해주세요.')
      } else if (phase === 'analysis-execution' && error?.status >= 500) {
        setRegistrationError('축제 기획안 분석 실행 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.')
      } else if (phase === 'analysis-summary' && error?.status === 404) {
        setRegistrationError('분석 결과 요약을 찾을 수 없습니다. 다시 시도해주세요.')
      } else if (phase === 'analysis-detail' && error?.status === 404) {
        setRegistrationError('분석 상세 결과를 찾을 수 없습니다. 다시 시도해주세요.')
      } else if ((phase === 'analysis-summary' || phase === 'analysis-detail') && error?.status >= 500) {
        setRegistrationError('분석 결과를 불러오는 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.')
      } else if (phase === 'analysis' && error?.status === 404) {
        setRegistrationError('등록된 축제 기획안을 찾을 수 없습니다. 다시 시도해주세요.')
      } else if (phase === 'analysis' && error?.status >= 500) {
        setRegistrationError('축제 기획안 분석 실행 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.')
      } else if (error?.status === 401 || error?.status === 403) {
        setRegistrationError('인증이 만료되었거나 권한이 없습니다. 다시 로그인해주세요.')
      }
      setIsAnalysisComplete(false)
      setStage('review')
    } finally {
      analysisStreamControllerRef.current = null
      registrationInFlightRef.current = false
      setIsRegisteringPlan(false)
    }
  }

  const openLogin = () => {
    setLoginError('')
    setLoginOpen(true)
  }

  const handleLogin = async (credentials) => {
    setLoginError('')
    try {
      await login(credentials)
      setIsSample(false)
      setLoginOpen(false)
      setStage('documents')
      navigate('/documents')
    } catch (error) {
      setLoginError(getLoginErrorMessage(error))
    }
  }

  const handleSignup = (credentials) => signup(credentials)

  const handleAuthModeChange = () => setLoginError('')

  const openSample = () => {
    const samplePlan = {
      ...SAMPLE,
      festivalThemes: SAMPLE.festivalThemes.map((pair) => ({ ...pair })),
      programs: [...SAMPLE.programs],
      programNames: [...(SAMPLE.programNames || [])],
      programCandidates: [...(SAMPLE.programCandidates || SAMPLE.programNames || [])],
      customProgramNames: [...(SAMPLE.customProgramNames || [])],
    }
    setOpenKey(null)
    setPlan(samplePlan)
    setAutoFilledFields({})
    setAnalysis(analyze(samplePlan))
    setReportState({ status: 'idle', analysis: null, error: null })
    setIsSample(true)
    setStage('report')
  }

  const handleLogout = async () => {
    try {
      await logout()
      setIsSample(false)
      setStage('landing')
      setStep(1)
      setAnalysis(null)
      navigate('/')
    } catch {
      // AuthProvider keeps the session when logout fails; the service remains usable.
    }
  }

  return (
    <>
      <Header
        stage={stage}
        onHome={openDocuments}
        onDocuments={openDocuments}
        onNew={startNewPlan}
        isAuthenticated={isAuthenticated}
        isPending={isPending}
        onLogin={openLogin}
        onSample={openSample}
        onLogout={handleLogout}
      />
      {stage === 'landing' && <LandingPage onStart={openLogin} onSample={openSample} />}
      {stage === 'documents' && (
        <DocumentsPage
          onDocumentsLoaded={handleDocumentsLoaded}
          onParsedPlan={handleParsedPlan}
          onOpenAnalysis={(document) => {
            setActiveDocument(document)
            setResultState({ status: 'loading', error: null })
            setOpenKey(null)
            setAnalysis(null)
            const analysisPlan = normalizeFestivalPlan(document.plan || EMPTY_PLAN)
            setPlan(analysisPlan)
            setAutoFilledFields({})
            setStage('result')
            navigate(`/analyses/${encodeURIComponent(document.analysisId)}`)
          }}
        />
      )}
      {stage === 'input' && (
        <FormScreen
          plan={plan}
          setPlan={setPlan}
          step={step}
          setStep={setStep}
          autoFilledFields={autoFilledFields}
          setAutoFilledFields={setAutoFilledFields}
          onReview={(p) => {
            setPlan(p)
            setRegistrationError('')
            setFestivalPlanResponse(null)
            setStage('review')
          }}
        />
      )}
      {stage === 'review' && (
        <ReviewScreen
          plan={plan}
          onEdit={goEdit}
          onAnalyze={handleAnalyze}
          isSubmitting={isRegisteringPlan}
          error={registrationError}
        />
      )}
      {stage === 'loading' && (
        <LoadingScreen
          plan={plan}
          onDone={finish}
          onRetry={goEdit}
          analysisProgress={analysisProgress}
          isComplete={isAnalysisComplete}
          isFailed={isAnalysisFailed}
        />
      )}
      {stage === 'result' && A && (
        <ResultScreen
          A={A}
          onEdit={goEdit}
          onReport={() => {
            setReportState({ status: 'loading', analysis: null, error: null })
            setStage('report')
            const analysisId = registeredAnalysisId || route.analysisId || analysis?.server?.analysisId
            if (analysisId) {
              navigate(`/reports/${encodeURIComponent(analysisId)}`)
            }
          }}
          onOpen={setOpenKey}
          openKey={openKey}
        />
      )}
      {stage === 'result' && !A && resultState.status === 'loading' && (
        <ResultLoadingScreen />
      )}
      {stage === 'result' && !A && resultState.status !== 'loading' && resultState.status !== 'idle' && (
        <ResultErrorScreen error={resultState.error} onBack={openDocuments} />
      )}
      {stage === 'report' && isSample && A && (
        <ReportScreen
          A={A}
          onBack={home}
          onPrint={() => window.print()}
          backLabel="랜딩으로 돌아가기"
        />
      )}
      {stage === 'report' && !isSample && reportState.status === 'loading' && (
        <ReportLoadingScreen />
      )}
      {stage === 'report' && !isSample && reportState.status === 'not-found' && (
        <ReportErrorScreen
          error={reportState.error}
          notFound
          onBack={openDocuments}
        />
      )}
      {stage === 'report' && !isSample && reportState.status === 'error' && (
        <ReportErrorScreen error={reportState.error} onBack={openDocuments} />
      )}
      {stage === 'report' && !isSample && reportState.status === 'success' && reportState.analysis && (
        <ReportScreen
          A={reportState.analysis}
          onBack={openDocuments}
          onPrint={() => window.print()}
          backLabel="문서 목록으로 돌아가기"
        />
      )}
      {openItem && A && (
        <Panel
          item={openItem}
          A={A}
          onClose={() => setOpenKey(null)}
          onEdit={goEdit}
          onMove={(direction) => {
            const next = ITEMS[index + direction]
            if (next) setOpenKey(next.key)
          }}
        />
      )}
      <LoginModal
        open={loginOpen}
        onClose={() => setLoginOpen(false)}
        onSubmit={handleLogin}
        onSignup={handleSignup}
        onModeChange={handleAuthModeChange}
        isPending={isPending}
        error={loginError}
      />
    </>
  )
}
