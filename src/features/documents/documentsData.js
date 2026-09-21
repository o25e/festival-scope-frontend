export const DOCUMENT_STATUS = {
  COMPLETED: 'completed',
  ANALYZING: 'analyzing',
  WAITING: 'waiting',
}

const formatDate = (value) => {
  if (!value) return '-'
  return String(value).slice(0, 10).replace(/-/g, '.')
}

const formatDateRange = (start, end) => {
  const formattedStart = formatDate(start)
  const formattedEnd = formatDate(end)
  if (formattedStart === '-' || formattedEnd === '-') return formattedStart
  if (formattedStart === formattedEnd) return formattedStart
  return `${formattedStart} ~ ${formattedEnd.slice(5)}`
}

const formatInputDate = (value) => {
  if (!value) return '-'
  const parts = String(value).slice(0, 10).split('-')
  return parts.length === 3 ? `${parts[1]}.${parts[2]}` : String(value)
}

const normalizeDocumentStatus = (value) => {
  const status = String(value ?? '').trim().toUpperCase()
  return {
    COMPLETED: DOCUMENT_STATUS.COMPLETED,
    ANALYZING: DOCUMENT_STATUS.ANALYZING,
    RUNNING: DOCUMENT_STATUS.ANALYZING,
    WAITING: DOCUMENT_STATUS.WAITING,
    PENDING: DOCUMENT_STATUS.WAITING,
  }[status] || value || DOCUMENT_STATUS.COMPLETED
}

export const mapAnalysisDocument = (item = {}) => ({
  ...item,
  analysisId: item.analysisId ?? item.id,
  festivalName: item.festivalName || item.name || '-',
  hostRegion: item.hostRegion || item.region || '-',
  festivalPeriod: formatDateRange(item.festivalStartDate, item.festivalEndDate),
  inputDate: formatInputDate(item.inputDate ?? item.createdAt),
  status: normalizeDocumentStatus(item.status ?? item.analysisStatus),
  overallScore: item.overallScore ?? item.totalScore ?? null,
  recommendationCount: item.recommendationCount ?? (
    Array.isArray(item.recommendations) ? item.recommendations.length : null
  ),
})
