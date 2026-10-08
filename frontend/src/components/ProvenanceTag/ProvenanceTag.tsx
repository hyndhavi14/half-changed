import type { Provenance } from '../../data/provenance'
import { PROVENANCE_LABEL } from '../../data/provenance'
import styles from './ProvenanceTag.module.css'

interface ProvenanceTagProps {
  provenance: Provenance
  label?: string
}

export default function ProvenanceTag({ provenance, label }: ProvenanceTagProps) {
  return (
    <span className={`${styles.tag} ${styles[provenance]}`}>
      {label ?? PROVENANCE_LABEL[provenance]}
    </span>
  )
}
