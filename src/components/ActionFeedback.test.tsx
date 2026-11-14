import {render,screen,cleanup,act,fireEvent} from '@testing-library/react';
import {afterEach,describe,it,expect,vi} from 'vitest';
import {ActionFeedback} from './ActionFeedback';
afterEach(()=>{cleanup();vi.useRealTimers();});
describe('action feedback',()=>{
 it('keeps confirmed success visible until dismissed',()=>{
  vi.useFakeTimers();const dismiss=vi.fn();render(<ActionFeedback success="Room pick saved." onDismiss={dismiss}/>);
  act(()=>vi.advanceTimersByTime(60000));expect(screen.getByRole('status')).toHaveTextContent('Saved successfully');
  fireEvent.click(screen.getByLabelText('Dismiss action message'));expect(dismiss).toHaveBeenCalledOnce();
 });
 it('explains a slow request without declaring failure or inviting another save',()=>{
  vi.useFakeTimers();render(<ActionFeedback busy/>);act(()=>vi.advanceTimersByTime(10000));
  expect(screen.getByRole('status')).toHaveTextContent('do not save again');expect(screen.queryByRole('alert')).not.toBeInTheDocument();
 });
 it('distinguishes a confirmed save from a failed refresh',()=>{
  render(<ActionFeedback success="Usage saved." error="Balances could not refresh."/>);
  expect(screen.getByRole('alert')).toHaveTextContent('Saved — refresh needs attention');
  expect(screen.getByRole('alert')).toHaveTextContent('Usage saved. Balances could not refresh.');
 });
});
