import { Routes } from '@angular/router';
import { authGuard } from './auth/auth.guard';
import { roleGuard, adminGuard, tableAccessGuard, orderAccessGuard, kitchenAccessGuard, scheduleGuard, workingPlanViewRedirectGuard, floorPlanGuard } from './auth/role.guard';
import { uiModuleGuard } from './auth/ui-module.guard';
import { reservationAccessGuard } from './auth/reservation-access.guard';
import { courierGuard } from './auth/courier.guard';
import { permissionGuard } from './auth/permission.guard';
import { tablesCanvasCanDeactivate } from './tables/tables-canvas-deactivate.guard';

export const routes: Routes = [
  // Public routes
  { path: '', redirectTo: 'login', pathMatch: 'full' },
  { path: 'login', loadComponent: () => import('./auth/login.component').then(m => m.LoginComponent) },
  { path: 'register', redirectTo: 'login', pathMatch: 'full' },
  { path: 'signup', redirectTo: 'login', pathMatch: 'full' },
  {
    path: 'terms',
    loadComponent: () => import('./legal/legal-document.component').then(m => m.LegalDocumentComponent),
    data: { legalDoc: 'terms' },
  },
  {
    path: 'privacy',
    loadComponent: () => import('./legal/legal-document.component').then(m => m.LegalDocumentComponent),
    data: { legalDoc: 'privacy' },
  },
  // Courier portal (public auth + protected home)
  { path: 'courier/login', loadComponent: () => import('./courier/courier-login.component').then(m => m.CourierLoginComponent) },
  { path: 'courier/orders/:id', canActivate: [courierGuard], loadComponent: () => import('./courier/courier-order-detail.component').then(m => m.CourierOrderDetailComponent) },
  { path: 'courier', canActivate: [courierGuard], loadComponent: () => import('./courier/courier-home.component').then(m => m.CourierHomeComponent) },
  { path: 'menu/:token', loadComponent: () => import('./menu/menu.component').then(m => m.MenuComponent) },
  { path: 'public-menu/:tenantId', loadComponent: () => import('./public-menu/public-menu.component').then(m => m.PublicMenuComponent) },
  {
    path: 'delivery/:tenantId/track',
    loadComponent: () =>
      import('./delivery/delivery-track.component').then((m) => m.DeliveryTrackComponent),
  },
  // Ordering now lives directly on the public menu page (#merge public-menu + delivery);
  // keep this old link working by sending it to the equivalent place there.
  { path: 'delivery/:tenantId', redirectTo: 'public-menu/:tenantId', pathMatch: 'full' },
  { path: 'book/:tenantId', loadComponent: () => import('./book/book.component').then(m => m.BookComponent) },
  { path: 'waitlist/:tenantId', loadComponent: () => import('./waitlist-public/waitlist-public.component').then(m => m.WaitlistPublicComponent) },
  { path: 'feedback/:tenantId', loadComponent: () => import('./feedback-public/feedback-public.component').then(m => m.FeedbackPublicComponent) },
  // Public take-away / home ordering: list tenants with ordering link
  { path: 'orders', loadComponent: () => import('./orders-public/orders-public.component').then(m => m.OrdersPublicComponent) },
  // Staff reservations (must be before 'reservation' so /reservations matches here, not the public route)
  { path: 'reservations', canActivate: [authGuard, uiModuleGuard('reservations'), reservationAccessGuard], loadComponent: () => import('./reservations/reservations.component').then(m => m.ReservationsComponent) },
  { path: 'guest-feedback', canActivate: [authGuard, uiModuleGuard('reservations'), reservationAccessGuard], loadComponent: () => import('./guest-feedback/guest-feedback.component').then(m => m.GuestFeedbackComponent) },
  { path: 'reservation', loadComponent: () => import('./reservation-view/reservation-view.component').then(m => m.ReservationViewComponent) },

  // Protected routes - accessible by all authenticated users
  { path: 'dashboard', canActivate: [authGuard], loadComponent: () => import('./dashboard/dashboard.component').then(m => m.DashboardComponent) },
  {
    path: 'catalog-inventory',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./catalog-inventory-hub/catalog-inventory-hub.component').then((m) => m.CatalogInventoryHubComponent),
  },
  { path: 'my-shift', canActivate: [authGuard], loadComponent: () => import('./my-shift/my-shift.component').then(m => m.MyShiftComponent) },

  // Products (menu editing) - owner only
  { path: 'products', canActivate: [authGuard, adminGuard], loadComponent: () => import('./products/products.component').then(m => m.ProductsComponent) },

  // Register `tables/canvas` before `tables` (prefix matching would otherwise match `/tables/canvas` as `/tables`).
  {
    path: 'tables/canvas',
    canActivate: [authGuard, uiModuleGuard('tables'), floorPlanGuard],
    canDeactivate: [tablesCanvasCanDeactivate],
    loadComponent: () => import('./tables/tables-canvas.component').then(m => m.TablesCanvasComponent),
  },
  { path: 'tables', canActivate: [authGuard, uiModuleGuard('tables'), tableAccessGuard], loadComponent: () => import('./tables/tables.component').then(m => m.TablesComponent) },

  // Staff orders (list and manage orders)
  { path: 'staff/orders', canActivate: [authGuard, orderAccessGuard], loadComponent: () => import('./orders/orders.component').then(m => m.OrdersComponent) },
  // Billing customers (Factura)
  { path: 'customers', canActivate: [authGuard, orderAccessGuard], loadComponent: () => import('./customers/customers.component').then(m => m.CustomersComponent) },
  // Kitchen display (cocina: main course) and Bar display (beverages only) - same component, filtered by category
  { path: 'kitchen', canActivate: [authGuard, uiModuleGuard('kitchen_bar'), kitchenAccessGuard], loadComponent: () => import('./kitchen-display/kitchen-display.component').then(m => m.KitchenDisplayComponent), data: { view: 'kitchen' } },
  { path: 'bar', canActivate: [authGuard, uiModuleGuard('kitchen_bar'), orderAccessGuard], loadComponent: () => import('./kitchen-display/kitchen-display.component').then(m => m.KitchenDisplayComponent), data: { view: 'bar' } },

  // Admin-only routes
  { path: 'settings', canActivate: [authGuard, adminGuard], loadComponent: () => import('./settings/settings.component').then(m => m.SettingsComponent) },
  { path: 'printing', canActivate: [authGuard, adminGuard], loadComponent: () => import('./printing/printing.component').then(m => m.PrintingComponent) },
  { path: 'users', canActivate: [authGuard, adminGuard, uiModuleGuard('users')], loadComponent: () => import('./users/users.component').then(m => m.UsersComponent) },

  // Inventory module (lazy loaded) - admin only
  { path: 'inventory', canActivate: [authGuard, adminGuard, uiModuleGuard('inventory')], loadChildren: () => import('./inventory/inventory.routes').then(m => m.INVENTORY_ROUTES) },

  // Reports (sales / revenue) - owner & admin
  { path: 'reports', canActivate: [authGuard, adminGuard], loadComponent: () => import('./reports/reports.component').then(m => m.ReportsComponent) },

  // Cash close (end-of-day register count) - owner & admin
  { path: 'cash-close', canActivate: [authGuard, adminGuard], loadComponent: () => import('./cash-close/cash-close.component').then(m => m.CashCloseComponent) },

  // Working plan (shift schedule) - all staff can add/edit; owner sees '*' when updated by others
  // pathMatch full + guard: redirect to /working-plan/week or /working-plan/calendar (guard runs first; loadComponent satisfies route config)
  { path: 'working-plan', pathMatch: 'full', canActivate: [authGuard, uiModuleGuard('working_plan'), scheduleGuard, workingPlanViewRedirectGuard], loadComponent: () => import('./working-plan/working-plan.component').then(m => m.WorkingPlanComponent) },
  { path: 'working-plan/:view', canActivate: [authGuard, uiModuleGuard('working_plan'), scheduleGuard], loadComponent: () => import('./working-plan/working-plan.component').then(m => m.WorkingPlanComponent) },

  // Slug-first guest booking (#415): after all fixed segments so /working-plan/book etc. stay reserved
  {
    path: ':publicSlug/book',
    loadComponent: () => import('./book/book.component').then((m) => m.BookComponent),
  },

  { path: '**', redirectTo: '' }
];

