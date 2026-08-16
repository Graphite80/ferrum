import { type SetPrescriptionSnapshot, type WeightUnit, formatLoad } from '@ferrum/domain';

// Design-style prescription line: "75 KG X 8 REP X 3 RIR" (uppercase, X separator).
export function prescriptionLine(
  prescription: SetPrescriptionSnapshot | null,
  unit: WeightUnit
): string | null {
  if (prescription == null) return null;
  const parts: string[] = [];
  if (prescription.targetLoadKg != null) {
    parts.push(formatLoad(prescription.targetLoadKg, { unit }).toUpperCase());
  }
  if (prescription.targetRepMin != null) {
    const reps =
      prescription.targetRepMax != null && prescription.targetRepMax !== prescription.targetRepMin
        ? `${String(prescription.targetRepMin)}-${String(prescription.targetRepMax)}`
        : String(prescription.targetRepMin);
    parts.push(`${reps} REP`);
  }
  if (prescription.targetRir != null) {
    const rir =
      prescription.targetRir[0] === prescription.targetRir[1]
        ? String(prescription.targetRir[0])
        : `${String(prescription.targetRir[0])}-${String(prescription.targetRir[1])}`;
    parts.push(`${rir} RIR`);
  }
  return parts.length > 0 ? parts.join(' X ') : null;
}
