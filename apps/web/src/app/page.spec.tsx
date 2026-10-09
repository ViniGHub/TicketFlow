import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import HomePage from './page';

describe('HomePage', () => {
  it('renderiza o nome do produto num título', () => {
    const html = renderToStaticMarkup(<HomePage />);

    expect(html).toMatch(/<h1[^>]*>Ticket<span[^>]*>Flow<\/span><\/h1>/);
  });
});
