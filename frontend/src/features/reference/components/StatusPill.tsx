import { STATUS_META, type ReferenceStatus } from '@/features/reference/model/referenceLibrary'

export function StatusPill({ status }: { status: ReferenceStatus }) {
  return (
    <span className="rfc-pill" data-s={status}>
      <i />
      {STATUS_META[status].label}
    </span>
  )
}
