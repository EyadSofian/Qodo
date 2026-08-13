interface GoogleCredentialResponse {
  credential: string;
  select_by?: string;
}

interface GoogleIdentityAccounts {
  initialize(options: {
    client_id: string;
    callback: (response: GoogleCredentialResponse) => void;
    context?: 'signin' | 'signup' | 'use';
    ux_mode?: 'popup' | 'redirect';
  }): void;
  renderButton(
    parent: HTMLElement,
    options: {
      type?: 'standard' | 'icon';
      theme?: 'outline' | 'filled_blue' | 'filled_black';
      size?: 'large' | 'medium' | 'small';
      text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
      shape?: 'rectangular' | 'pill' | 'circle' | 'square';
      width?: number;
      locale?: string;
    }
  ): void;
  cancel(): void;
}

interface Window {
  google?: { accounts: { id: GoogleIdentityAccounts } };
}
