-- Only Nata staff can set a password.
--
-- Run AFTER 20240192_dashboard_revenue_and_routes.sql. Safe to re-run.
--
-- Members sign in to the app with an SMS code; only the website's staff pages
-- use phone + password. The website's "Set your password" flow (SMS code, then
-- supabase.auth.updateUser({ password })) must therefore work for staff only,
-- and the rule has to hold for any client, not just the website.
--
-- A trigger on auth.users refuses to change encrypted_password to a new,
-- non-empty value unless the account is in nata.admins ('nata:password_staff_only').
-- Clearing a password is always allowed.
--
-- New accounts are left alone on purpose: Supabase stores a random password
-- when someone signs up with an SMS code, and refusing that insert would break
-- sign-up in the app. Nobody knows those generated passwords.

create or replace function nata.only_staff_set_passwords()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.encrypted_password is distinct from old.encrypted_password
     and coalesce(new.encrypted_password, '') <> ''
     and not nata.is_admin(new.id) then
    raise exception 'nata:password_staff_only';
  end if;
  return new;
end;
$$;

revoke all on function nata.only_staff_set_passwords() from public, anon, authenticated;

drop trigger if exists only_staff_set_passwords on auth.users;
create trigger only_staff_set_passwords
  before update of encrypted_password on auth.users
  for each row execute function nata.only_staff_set_passwords();
