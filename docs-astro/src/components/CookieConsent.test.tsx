import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import CookieConsent from './CookieConsent';

describe('CookieConsent', () => {
  beforeEach(() => {
    localStorage.clear();
    window.__getAnalyticsConsent = undefined;
    window.__setAnalyticsConsent = undefined;
    window.__ensurePlausibleLoaded = undefined;
  });

  it('renders a banner when there is no stored preference', () => {
    render(<CookieConsent locale="en" />);

    expect(screen.getByText('Privacy-friendly analytics')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Decline' })).toBeInTheDocument();
  });

  it('accept stores preference and notifies BaseLayout helper', async () => {
    const user = userEvent.setup();
    const setConsent = vi.fn();
    window.__setAnalyticsConsent = setConsent;

    render(<CookieConsent locale="en" />);

    await user.click(screen.getByRole('button', { name: 'Accept' }));

    expect(localStorage.getItem('analytics-consent')).toBe('accepted');
    expect(setConsent).toHaveBeenCalledWith('accepted');
    expect(screen.queryByText('Privacy-friendly analytics')).not.toBeInTheDocument();
  });

  it('decline stores preference and notifies BaseLayout helper', async () => {
    const user = userEvent.setup();
    const setConsent = vi.fn();
    window.__setAnalyticsConsent = setConsent;

    render(<CookieConsent locale="en" />);

    await user.click(screen.getByRole('button', { name: 'Decline' }));

    expect(localStorage.getItem('analytics-consent')).toBe('declined');
    expect(setConsent).toHaveBeenCalledWith('declined');
    expect(screen.queryByText('Privacy-friendly analytics')).not.toBeInTheDocument();
  });

  it('does not render when there is an existing preference', () => {
    localStorage.setItem('analytics-consent', 'declined');

    render(<CookieConsent locale="en" />);

    expect(screen.queryByText('Privacy-friendly analytics')).not.toBeInTheDocument();
  });
});

