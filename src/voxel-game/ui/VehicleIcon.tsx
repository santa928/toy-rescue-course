import type { ReactElement } from 'react';
import type { VehicleId } from '../domain/vehicleDefinitions';

/** 車体の色だけに頼らず、梯子・履帯・アーム・救急印・灯火で識別する玩具ピクト。 */
export function VehicleIcon({ vehicleId }: { readonly vehicleId: VehicleId }): ReactElement {
  const tracked = vehicleId === 'bulldozer' || vehicleId === 'excavator';
  return (
    <svg aria-hidden="true" className="vehicle-icon" viewBox="0 0 96 56" focusable="false">
      <g stroke="#27313d" strokeWidth="3" strokeLinejoin="round">
        {tracked ? (
          <>
            <rect x="12" y="37" width="58" height="14" rx="6" fill="#444d58" />
            <path d="M22 44h38" stroke="#bfc7c8" strokeDasharray="4 4" />
          </>
        ) : (
          <>
            <circle cx="25" cy="45" r="8" fill="#27313d" />
            <circle cx="72" cy="45" r="8" fill="#27313d" />
          </>
        )}
        {vehicleId === 'fire-truck' && (
          <>
            <path d="M9 18h45v-5h21l12 15v13H9z" fill="#e45840" />
            <path d="M59 18h13l8 11H59z" fill="#b5e2e5" />
            <path d="M12 13h39M12 6h39M17 6v7m10-7v7m10-7v7m10-7v7" stroke="#637883" />
            <path d="M15 25h34v12H15z" fill="#f5d064" />
            <path d="M60 8h11" stroke="#e74e46" strokeWidth="6" />
          </>
        )}
        {vehicleId === 'bulldozer' && (
          <>
            <path d="M18 15h27v22H18z" fill="#9ddce2" />
            <path d="M13 11h36v7H13zm0 21h49v7H13z" fill="#f4bf3b" />
            <path d="M50 29h16l10 13H50z" fill="#f4bf3b" />
            <path d="M75 26h12v24H69z" fill="#b8c8cb" />
          </>
        )}
        {vehicleId === 'excavator' && (
          <>
            <path d="M16 19h28v19H16z" fill="#ef9632" />
            <path d="M20 20h18v12H20z" fill="#b5e2e5" />
            <path d="M44 34 58 7l16 7 8 20-7 3-8-17-6-3-10 22z" fill="#ef9632" />
            <path d="M73 34h17v14H77l-9-7z" fill="#657680" />
          </>
        )}
        {vehicleId === 'ambulance' && (
          <>
            <path d="M9 13h48v4h17l13 15v10H9z" fill="#fffaf0" />
            <path d="M61 21h11l8 10H61z" fill="#a6dfe5" />
            <path d="M10 35h75" stroke="#e85749" strokeWidth="5" />
            <path d="M28 18v13m-6-6h12" stroke="#e85749" strokeWidth="5" />
            <path d="M61 10h12" stroke="#e85749" strokeWidth="6" />
          </>
        )}
        {vehicleId === 'police' && (
          <>
            <path d="m9 32 12-5 10-12h33l13 15 10 3v10H9z" fill="#fffaf0" />
            <path d="M34 20h25l9 10H25z" fill="#abdfe4" />
            <path d="M10 36h76" stroke="#27313d" strokeWidth="8" />
            <path d="M37 10h9" stroke="#ec5c53" strokeWidth="6" />
            <path d="M49 10h9" stroke="#3879d9" strokeWidth="6" />
            <path d="M49 22v7" />
          </>
        )}
        {!tracked && <path d="M25 45h0m47 0h0" stroke="#bac6cb" strokeWidth="5" strokeLinecap="round" />}
      </g>
    </svg>
  );
}
