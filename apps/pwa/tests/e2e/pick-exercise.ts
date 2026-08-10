import { expect, type Locator, type Page } from '@playwright/test';

// Exact text, because a family name is a substring of its neighbours: "Bench Press"
// also matches the Close Grip Bench Press tile sitting under it.
export function groupTile(page: Page, groupName: string): Locator {
  return page
    .getByTestId('exercise-search-result')
    .filter({ has: page.getByText(groupName, { exact: true }) });
}

// The picker lists families, not definitions, so choosing an exercise is two taps
// wherever a family has more than one variant. Shared so a test reads as "add the
// dumbbell bench press" rather than restating the panel's shape.
export async function pickExercise(
  page: Page,
  query: string,
  groupName: string,
  variantLabel?: string
): Promise<void> {
  await page.getByTestId('exercise-search-input').fill(query);
  await groupTile(page, groupName).click();
  if (variantLabel !== undefined) {
    await page
      .getByTestId('exercise-variant-option')
      .filter({ hasText: variantLabel })
      .first()
      .click();
  }
  await expect(page.getByTestId('exercise-search')).toBeHidden();
}
