import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../art', () => ({
  artUrl: (n: string) => (n === 'empty-done' ? '/a/empty-done.jpg' : null),
}));
const { ArtSlot } = await import('./ArtSlot');

describe('ArtSlot', () => {
  it('renders a decorative image when the art exists', () => {
    const { container } = render(<ArtSlot name="empty-done" />);
    const img = container.querySelector('img')!;
    expect(img).toHaveAttribute('alt', '');
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true');
  });
  it('renders the placeholder when the art is missing', () => {
    const { container } = render(<ArtSlot name="about-registry" />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.art-placeholder')).not.toBeNull();
  });
  it('falls back to the placeholder when the image fails to load', () => {
    const { container } = render(<ArtSlot name="empty-done" />);
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('.art-placeholder')).not.toBeNull();
  });
});
