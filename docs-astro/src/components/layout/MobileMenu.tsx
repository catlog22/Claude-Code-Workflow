import { useEffect, useState } from 'react';

/**
 * MobileMenu - React Island for managing mobile sidebar state
 *
 * This component handles:
 * - Mobile menu open/close state
 * - Focus trap when sidebar is open
 * - Body scroll lock
 * - Escape key handling
 */
export default function MobileMenu() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    // Listen for toggle event from Header component
    const handleToggle = (e: Event) => {
      const customEvent = e as CustomEvent<{ open: boolean }>;
      setIsOpen(customEvent.detail.open);
    };

    window.addEventListener('toggle-mobile-menu', handleToggle);

    return () => {
      window.removeEventListener('toggle-mobile-menu', handleToggle);
    };
  }, []);

  useEffect(() => {
    // Lock body scroll when sidebar is open
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  useEffect(() => {
    // Handle escape key
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);

        // Update mobile menu toggle button
        const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
        mobileMenuToggle?.setAttribute('aria-expanded', 'false');

        // Dispatch event to close sidebar
        window.dispatchEvent(new CustomEvent('toggle-mobile-menu', { detail: { open: false } }));
      }
    };

    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  // Focus trap implementation
  useEffect(() => {
    if (!isOpen) return;

    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;

    // Get all focusable elements in sidebar
    const focusableElements = sidebar.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), details, [tabindex]:not([tabindex="-1"])'
    );

    const firstFocusable = focusableElements[0];
    const lastFocusable = focusableElements[focusableElements.length - 1];

    const handleTabKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      if (e.shiftKey) {
        // Shift + Tab
        if (document.activeElement === firstFocusable) {
          e.preventDefault();
          lastFocusable?.focus();
        }
      } else {
        // Tab
        if (document.activeElement === lastFocusable) {
          e.preventDefault();
          firstFocusable?.focus();
        }
      }
    };

    document.addEventListener('keydown', handleTabKey);

    // Focus first element when opened
    firstFocusable?.focus();

    return () => {
      document.removeEventListener('keydown', handleTabKey);
    };
  }, [isOpen]);

  // This component doesn't render anything visible
  // It only manages state and side effects
  return null;
}
