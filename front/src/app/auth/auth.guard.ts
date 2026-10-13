import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, of, switchMap } from 'rxjs';
import { ApiService } from '../services/api.service';

export const authGuard: CanActivateFn = () => {
  const apiService = inject(ApiService);
  const router = inject(Router);

  const afterAuth = (user: { role?: string } | null) => {
    if (!user) {
      return of(router.createUrlTree(['/login']));
    }
    if (user.role === 'courier') {
      return of(router.createUrlTree(['/courier']));
    }
    return of(true);
  };

  const cached = apiService.getCurrentUser();
  if (cached) {
    return afterAuth(cached);
  }

  return apiService.checkAuth().pipe(
    switchMap((user) => afterAuth(user)),
    catchError(() => of(router.createUrlTree(['/login']))),
  );
};
