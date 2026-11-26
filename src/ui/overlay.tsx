import { useEffect, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

let openCount = 0;

/** Модальный слой на document.body, чтобы нижняя панель экрана не перекрывала лист и клавиатуру (особенно в Safari). */
export function Overlay({ className = 'ov', onClick, children, role = 'presentation', 'aria-label': ariaLabel }: {
  className?: string;
  onClick?: (e: MouseEvent<HTMLDivElement>) => void;
  children: ReactNode;
  role?: string;
  'aria-label'?: string;
}) {
  useEffect(() => {
    openCount += 1;
    document.body.classList.add('sheet-open');
    return () => {
      openCount -= 1;
      if (openCount <= 0) {
        openCount = 0;
        document.body.classList.remove('sheet-open');
      }
    };
  }, []);
  return createPortal(
    <div className={className} onClick={onClick} role={role} aria-label={ariaLabel}>{children}</div>,
    document.body,
  );
}
