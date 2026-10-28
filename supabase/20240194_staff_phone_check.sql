-- Website "Set your password": check the number is staff before texting a code.
--
-- Run AFTER 20240193_staff_only_passwords.sql. Safe to re-run.
--
-- public.is_staff_phone(p_phone) answers true only when the number belongs to
-- an account in nata.admins. The login page calls it before
-- signInWithOtp, so members never get an SMS for a website password and are
-- told the option is for the Nata team instead.
--
-- Callable signed out (the visitor isn't signed in yet). It returns a single
-- yes/no, never an account or a name. Numbers are compared digits only:
-- auth.users.phone is stored without the "+" (e.g. 15551234567).
--
-- The rule itself is still enforced by 20240193 (no password for non-staff);
-- this only spares members a useless code.

create or replace function public.is_staff_phone(p_phone text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) >= 6
     and exists (
           select 1
             from nata.admins a
             join auth.users u on u.id = a.user_id
            where regexp_replace(coalesce(u.phone, ''), '\D', '', 'g')
                = regexp_replace(p_phone, '\D', '', 'g')
         );
$$;

revoke all on function public.is_staff_phone(text) from public;
grant execute on function public.is_staff_phone(text) to anon, authenticated;
