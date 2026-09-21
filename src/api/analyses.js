import { fetchEventSource } from '@microsoft/fetch-event-source'
import { ApiError, getApiUrl, refreshAccessToken, request } from './http'
import { getAccessToken } from '../auth/authStorage'

const ANALYSES_PATH = '/api/analyses'

const isAnalysisId = (value) => {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0
  return typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value.trim())
}

export const getAnalysisId = (response) => {
  const value = isAnalysisId(response)
    ? response
    : response?.data ?? response?.analysisId
  return isAnalysisId(value) ? String(value).trim() : null
}

const assertSuccess = (response, fallbackMessage) => {
  if (response?.success === false) {
    throw new ApiError(response.message || fallbackMessage, { data: response })
  }
  return response
}

const unwrapAnalysisData = (response, fallbackMessage) => {
  const successfulResponse = assertSuccess(response, fallbackMessage)
  if (!successfulResponse || !Object.prototype.hasOwnProperty.call(successfulResponse, 'data')) {
    throw new ApiError(fallbackMessage, { data: response })
  }
  return successfulResponse.data
}

export const getAnalysisDocuments = ({ page = 0, size = 10, signal } = {}) => {
  const params = new URLSearchParams({
    page: String(page),
    size: String(size),
  })

  return request(`${ANALYSES_PATH}?${params.toString()}`, {
    auth: true,
    signal,
  }).then((response) =>
    unwrapAnalysisData(response, '遺꾩꽍 臾몄꽌 紐⑸줉??遺덈윭?ㅼ? 紐삵뻽?듬땲??'),
  )
}

export const getAnalysis = (analysisId, options = {}) => {
  if (!isAnalysisId(analysisId)) {
    throw new ApiError('분석 결과를 조회할 analysisId가 유효하지 않습니다.')
  }

  return request(`${ANALYSES_PATH}/${encodeURIComponent(String(analysisId).trim())}`, {
    ...options,
    auth: true,
  }).then((response) =>
    unwrapAnalysisData(response, '분석 결과 요약을 불러오지 못했습니다.'),
  )
}

export const getAnalysisReport = (analysisId, options = {}) => {
  if (!isAnalysisId(analysisId)) {
    throw new ApiError('분석 리포트 조회 조건이 유효하지 않습니다.')
  }

  return request(
    `${ANALYSES_PATH}/${encodeURIComponent(String(analysisId).trim())}/report`,
    {
      ...options,
      auth: true,
    },
  ).then((response) => {
    const successfulResponse = assertSuccess(response, '분석 최종 리포트를 불러오지 못했습니다.')
    if (successfulResponse?.summary) return successfulResponse
    if (successfulResponse?.data?.summary) return successfulResponse.data
    return successfulResponse
  })
}

export const getAnalysisItem = (analysisId, itemType, options = {}) => {
  if (!isAnalysisId(analysisId) || typeof itemType !== 'string' || !itemType.trim()) {
    throw new ApiError('분석 상세 결과 조회 조건이 유효하지 않습니다.')
  }

  return request(
    `${ANALYSES_PATH}/${encodeURIComponent(String(analysisId).trim())}/items/${encodeURIComponent(itemType.trim())}`,
    {
      ...options,
      auth: true,
    },
  ).then((response) =>
    unwrapAnalysisData(response, `${itemType} 분석 결과를 불러오지 못했습니다.`),
  )
}

export const getTargetVisitorAnalysis = (analysisId, options = {}) =>
  getAnalysisItem(analysisId, 'TARGET_VISITOR', options)

export const getTrendFitAnalysis = (analysisId, options = {}) =>
  getAnalysisItem(analysisId, 'TREND_FIT', options)

export const getDemandFitAnalysis = (analysisId, options = {}) =>
  getAnalysisItem(analysisId, 'DEMAND_FIT', options)

export const getConflictRiskAnalysis = (analysisId, options = {}) =>
  getAnalysisItem(analysisId, 'CONFLICT_RISK', options)

export const getWeatherRiskAnalysis = (analysisId, options = {}) =>
  getAnalysisItem(analysisId, 'WEATHER_RISK', options)

export const getTourismLinkageAnalysis = (analysisId, options = {}) =>
  getAnalysisItem(analysisId, 'TOURISM_LINKAGE', options)

const normalizePlanId = (planId) => {
  const value = typeof planId === 'string' ? planId.trim() : planId
  if (
    (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) &&
    (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value))
  ) {
    throw new ApiError('분석을 실행할 축제 기획안 ID가 유효하지 않습니다.')
  }
  return String(value)
}

export const executeFestivalPlanAnalysis = (planId, options = {}) => {
  const normalizedPlanId = normalizePlanId(planId)

  return request(
    `/api/festival-plans/${encodeURIComponent(normalizedPlanId)}/analyses`,
    {
      ...options,
      method: 'POST',
      auth: true,
      body: undefined,
    },
  ).then((response) => {
    if (response?.success === false) {
      throw new ApiError(response.message || '축제 기획안 분석 실행에 실패했습니다.', {
        data: response,
      })
    }
    return response
  })
}

class AnalysisProgressAuthError extends Error {
  constructor(status) {
    super('SSE authentication failed')
    this.name = 'AnalysisProgressAuthError'
    this.status = status
  }
}

class AnalysisProgressHttpError extends Error {
  constructor(status) {
    super(`SSE request failed (${status})`)
    this.name = 'AnalysisProgressHttpError'
    this.status = status
  }
}

class AnalysisProgressProtocolError extends Error {
  constructor(message) {
    super(message)
    this.name = 'AnalysisProgressProtocolError'
  }
}

const isAbortError = (error) =>
  error?.name === 'AbortError' || error?.cause?.name === 'AbortError'

const isTerminalProgress = (progress) =>
  progress?.step === 'ANALYSIS' &&
  (progress?.status === 'COMPLETED' || progress?.status === 'FAILED')

const getProgressHeaders = () => {
  const token = getAccessToken()
  return {
    Accept: 'text/event-stream',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

export const streamAnalysisProgress = async (
  analysisId,
  { signal, onProgress } = {},
) => {
  if (!isAnalysisId(analysisId)) {
    throw new ApiError('분석 진행 데이터 조회에 필요한 analysisId가 유효하지 않습니다.')
  }

  const connectionController = new AbortController()
  const abortConnection = () => connectionController.abort()
  signal?.addEventListener('abort', abortConnection, { once: true })

  let terminalProgress = null
  let authRetryCount = 0

  try {
    while (!terminalProgress) {
      try {
        await fetchEventSource(
          getApiUrl(
            `${ANALYSES_PATH}/${encodeURIComponent(String(analysisId).trim())}/progress`,
          ),
          {
            method: 'GET',
            headers: getProgressHeaders(),
            signal: connectionController.signal,
            openWhenHidden: true,
            async onopen(response) {
              if (response.ok) return
              if (response.status === 401) {
                throw new AnalysisProgressAuthError(response.status)
              }
              throw new AnalysisProgressHttpError(response.status)
            },
            onmessage(event) {
              if (!event.data) return

              let progress
              try {
                progress = JSON.parse(event.data)
              } catch (error) {
                throw new AnalysisProgressProtocolError(
                  'SSE progress event is not valid JSON',
                  { cause: error },
                )
              }

              if (!progress || typeof progress !== 'object') {
                throw new AnalysisProgressProtocolError(
                  'SSE progress event has an invalid shape',
                )
              }

              onProgress?.(progress)
              if (isTerminalProgress(progress)) {
                terminalProgress = progress
                connectionController.abort()
              }
            },
            onclose() {
              if (!terminalProgress) {
                throw new TypeError('SSE connection closed before analysis completed')
              }
            },
            onerror(error) {
              if (terminalProgress) throw new Error('SSE stream completed')
              if (error instanceof AnalysisProgressAuthError) throw error
              if (error instanceof AnalysisProgressProtocolError) throw error
              if (error instanceof AnalysisProgressHttpError && error.status < 500) {
                throw error
              }
              if (isAbortError(error)) throw error

              // fetch-event-source will reconnect after transient network and
              // server failures. The current analysisId is intentionally kept.
              return 1500
            },
          },
        )
      } catch (error) {
        if (terminalProgress) break
        if (isAbortError(error)) throw error

        if (error instanceof AnalysisProgressAuthError && authRetryCount < 1) {
          authRetryCount += 1
          await refreshAccessToken()
          continue
        }

        if (error instanceof AnalysisProgressAuthError) {
          throw new ApiError('SSE 인증 처리에 실패했습니다.', {
            status: error.status,
            cause: error,
          })
        }

        if (error instanceof AnalysisProgressHttpError) {
          throw new ApiError('분석 진행 연결에 실패했습니다.', {
            status: error.status,
            cause: error,
          })
        }

        throw error
      }
    }
  } finally {
    signal?.removeEventListener('abort', abortConnection)
    connectionController.abort()
  }

  return terminalProgress
}
