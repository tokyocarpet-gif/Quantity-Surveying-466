import { companyIssuerLines, type CompanyIdentity } from './business'
export function CompanyBlock({ company }: { company: CompanyIdentity }): React.JSX.Element {
  return (
    <span className="company-block">
      {companyIssuerLines(company).map((line, i) => (
        <span key={i} className={`company-line company-line-${line.kind}`}>
          {line.text}
        </span>
      ))}
    </span>
  )
}
export const companyBlockCss = `
.company-block{display:block;text-align:left;white-space:normal;font-size:12px;line-height:1.35;font-weight:400;color:#172321}
.company-block .company-line{display:block;white-space:pre-wrap;overflow-wrap:anywhere}
.company-block .company-line-name{font-size:20px;line-height:1.3;margin:1mm 0 .5mm;font-weight:600}
.company-block .company-line-postal{padding-left:4mm}
.company-block .company-line-address,.company-block .company-line-phone,.company-block .company-line-extra{padding-left:8mm}
.company-block .company-line-extra{font-size:10px}
`
