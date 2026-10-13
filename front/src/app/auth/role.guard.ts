import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { ApiService, UserRole } from '../services/api.service';
import { PermissionService } from '../services/permission.service';
import { firstValueFrom } from 'rxjs';

/**
 * Route guard factory that checks if the user has one of the allowed roles.
 *
 * Usage in routes:
 * ```typescript
 * {
 *   path: 'settings',
 *   loadComponent: () => import('./settings/settings.component'),
 *   canActivate: [authGuard, roleGuard(['owner'])]
 * }
 * ```
 */
export function roleGuard(allowedRoles: UserRole[]): CanActivateFn {
  return async (route, state) => {
    const api = inject(ApiService);
    const router = inject(Router);
    const permissionService = inject(PermissionService);

    // First check if user is authenticated
    let user = api.getCurrentUser();

    // If no user in memory, try to fetch from backend
    if (!user) {
      try {
        user = await firstValueFrom(api.checkAuth());
      } catch {
        // Not authenticated - redirect to login
        router.navigate(['/login']);
        return false;
      }
    }

    // Check if user is authenticated
    if (!user) {
      router.navigate(['/login']);
      return false;
    }

    // Check if user has one of the allowed roles
    if (!permissionService.hasRole(user, ...allowedRoles)) {
      console.warn(`Access denied to ${state.url}. User role: ${user.role}, Required: ${allowedRoles.join(', ')}`);
      if (user.role === 'courier') {
        router.navigate(['/courier']);
      } else {
        router.navigate(['/dashboard']);
      }
      return false;
    }

    return true;
  };
}

/**
 * Route guard that only allows owners
 */
export const ownerGuard: CanActivateFn = roleGuard(['owner']);

/**
 * Route guard for the restaurant administrator (owner)
 */
export const adminGuard: CanActivateFn = ownerGuard;

/**
 * Route guard that allows staff with table access (owner, waiter)
 */
export const tableAccessGuard: CanActivateFn = roleGuard(['owner', 'waiter']);

/**
 * Route guard that allows staff with order access (owner, kitchen, waiter)
 */
export const orderAccessGuard: CanActivateFn = roleGuard(['owner', 'kitchen', 'waiter']);

/**
 * Route guard for the kitchen display and product catalog: waiters don't need these screens.
 */
export const kitchenAccessGuard: CanActivateFn = roleGuard(['owner', 'kitchen']);

/**
 * Route guard that allows all staff who can add/edit the working plan (schedule)
 */
export const scheduleGuard: CanActivateFn = roleGuard(['owner', 'kitchen', 'waiter']);

/**
 * Floor plan (/tables/canvas) is for the administrator only; waiters are sent to the table list
 * (also covers a remembered "last tables view" in the sidebar link).
 */
export const floorPlanGuard: CanActivateFn = async () => {
  const api = inject(ApiService);
  const router = inject(Router);
  let user = api.getCurrentUser();
  if (!user) {
    try {
      user = await firstValueFrom(api.checkAuth());
    } catch {
      return router.createUrlTree(['/login']);
    }
  }
  return user?.role === 'owner' ? true : router.createUrlTree(['/tables']);
};

const WORKING_PLAN_VIEW_KEY = 'workingPlanView';
const VALID_VIEWS = ['week', 'calendar'] as const;

/**
 * Redirects /working-plan to /working-plan/:view using the last-opened view from localStorage (default: week).
 */
export const workingPlanViewRedirectGuard: CanActivateFn = () => {
  const router = inject(Router);
  const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(WORKING_PLAN_VIEW_KEY) : null;
  const view = raw && VALID_VIEWS.includes(raw as (typeof VALID_VIEWS)[number]) ? raw : 'week';
  return router.createUrlTree(['/working-plan', view]);
};
