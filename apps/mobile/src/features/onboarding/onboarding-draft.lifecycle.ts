type DraftLifecycleStore = Readonly<{
  purge(accountId: string): Promise<void>;
}>;

/** Coordinates draft cleanup when onboarding or the authenticated account ends. */
export function createOnboardingDraftLifecycle(options: { store: DraftLifecycleStore }) {
  const purge = (accountId: string) => options.store.purge(accountId);

  return {
    successfulSave(accountId: string): Promise<void> {
      return purge(accountId);
    },
    cancel(accountId: string): Promise<void> {
      return purge(accountId);
    },
    signOut(accountId: string): Promise<void> {
      return purge(accountId);
    },
    accountSwitch(previousAccountId: string): Promise<void> {
      return purge(previousAccountId);
    },
  };
}
