import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SetupStep } from './SetupStep';

describe('SetupStep', () => {
  it('shows progress as filled segments and a step label', () => {
    const { container } = render(
      <SetupStep step={2} total={6} title="About you" onNext={() => {}}>
        <p>fields</p>
      </SetupStep>,
    );
    const bar = screen.getByRole('progressbar', { name: 'Setup progress' });
    expect(bar).toHaveAttribute('aria-valuenow', '2');
    expect(bar).toHaveAttribute('aria-valuemax', '6');
    expect(screen.getByText('Step 2 of 6')).toBeInTheDocument();
    expect(bar.children).toHaveLength(6);
    expect(container.querySelectorAll('[class*="filled"]')).toHaveLength(2);
  });

  it('Next submits, Enter in a field submits, and nothing happens while disabled', async () => {
    const user = userEvent.setup();
    const onNext = vi.fn();
    const { rerender } = render(
      <SetupStep step={1} total={6} title="About you" onNext={onNext} nextDisabled>
        <input aria-label="Age" />
      </SetupStep>,
    );
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: 'Age' }), '30{Enter}');
    expect(onNext).not.toHaveBeenCalled();

    rerender(
      <SetupStep step={1} total={6} title="About you" onNext={onNext}>
        <input aria-label="Age" />
      </SetupStep>,
    );
    await user.type(screen.getByRole('textbox', { name: 'Age' }), '{Enter}');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(onNext).toHaveBeenCalledTimes(2);
  });

  it('offers Back and Skip only when given', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    const onSkip = vi.fn();
    const { rerender } = render(<SetupStep step={3} total={6} title="Your regulars" onNext={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Skip' })).not.toBeInTheDocument();

    rerender(<SetupStep step={3} total={6} title="Your regulars" onNext={() => {}} onBack={onBack} onSkip={onSkip} />);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(screen.getByRole('button', { name: 'Skip' }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onSkip).toHaveBeenCalledTimes(1);
  });
});
