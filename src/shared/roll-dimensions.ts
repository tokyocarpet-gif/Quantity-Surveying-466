export type RollDimensionType = 'tile' | 'sheet' | 'carpet'
export type DimensionAxis = 'W' | 'L' | 'T'
export const dimensionUnit = (type: RollDimensionType, axis: DimensionAxis = 'L'): 'm' | 'mm' =>
  type === 'sheet' && axis !== 'T' ? 'm' : 'mm'
export const dimensionValue = (
  mm: number,
  type: RollDimensionType,
  axis: DimensionAxis = 'L'
): number => (dimensionUnit(type, axis) === 'm' ? mm / 1000 : mm)
export function dimensionNumber(
  mm: number,
  type: RollDimensionType,
  axis: DimensionAxis = 'L',
  grouping = true
): string {
  const decimals =
    dimensionUnit(type, axis) === 'm' ? 1 : type === 'carpet' ? 0 : axis === 'T' ? 3 : 1
  return dimensionValue(mm, type, axis).toLocaleString('ja-JP', {
    useGrouping: grouping,
    minimumFractionDigits: dimensionUnit(type, axis) === 'm' ? 1 : 0,
    maximumFractionDigits: decimals
  })
}
export const dimensionLabel = (
  mm: number,
  type: RollDimensionType,
  axis: DimensionAxis = 'L'
): string => `${dimensionNumber(mm, type, axis)} ${dimensionUnit(type, axis)}`
