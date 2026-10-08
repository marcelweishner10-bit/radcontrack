import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { TracstocBrand } from '@/components/TracstocBrand';
import { Loader2 } from 'lucide-react';

const Auth = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [registering, setRegistering] = useState(false);
  const { signIn, signUp, signOut, user, accessError, retryAccess } = useAuth();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    setSubmitting(true);
    const { error } = await (registering ? signUp(email.trim(), password) : signIn(email.trim(), password));
    setSubmitting(false);

    if (error) {
      toast({
        title: 'Sign-in failed',
        description: error.message || 'Unable to sign in. Please try again.',
        variant: 'destructive',
      });
    } else if (registering) {
      toast({ title: 'Registration received', description: 'Confirm your email, then ask the stock administrator to approve your account.' });
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="dashboard-card p-8 w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3">
          <h1><TracstocBrand large /></h1>
          <p className="text-sm text-foreground">Radiology operations & inventory</p>
          <p className="text-sm text-muted-foreground">Sign in to continue</p>
        </div>

        {accessError && <div className="space-y-3"><p role="alert">{accessError}</p><Button variant="outline" onClick={retryAccess}>Retry login check</Button></div>}
        {user ? <Button onClick={async()=>{const {error}=await signOut();if(error)toast({title:'Unable to sign out',description:error.message,variant:'destructive'});}}>Sign out and try another account</Button> : <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="you@hospital.org"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
            />
          </div>
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {registering ? 'Create staff login' : 'Sign In'}
          </Button>
          <Button type="button" variant="link" className="w-full" onClick={()=>setRegistering(!registering)}>{registering ? 'Already have an account? Sign in' : 'Staff: create your own login'}</Button>
          {registering && <p className="text-sm text-muted-foreground">Your account needs administrator approval before it can access radiology records.</p>}
        </form>}
      </div>
    </div>
  );
};

export default Auth;
