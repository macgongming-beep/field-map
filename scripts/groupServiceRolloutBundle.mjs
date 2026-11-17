import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'

export const rolloutMigrations = [
  '20261116_1000_group_service.sql', '20261116_1010_service_event_conflict_response.sql',
  '20261116_1020_unassigned_service_templates.sql', '20261116_1030_preserve_cart_schedule_contract.sql',
  '20261116_1040_optional_meeting_access.sql', '20261116_1100_service_application_activity.sql',
  '20261116_1200_group_service_tabs.sql', '20261116_1210_group_service_scope_integrity.sql',
  '20261116_1220_group_participant_signals.sql', '20261117_1000_assignment_and_schedule_permissions.sql',
  '20261117_1010_assignment_revisions.sql', '20261117_1100_assignment_revision_followup.sql',
  '20261117_1200_assignment_merge_and_application_guards.sql', '20261117_1300_allow_staff_add_after_closing.sql',
  '20261117_1400_group_event_comments.sql', '20261117_1500_group_comment_authenticated_reads.sql',
  '20261117_1600_optional_cart_service_contract.sql', '20261117_1700_assignment_rollout_control.sql',
]

export function buildGroupRolloutBundle() {
  const sources = rolloutMigrations.map(name => ({name, sql:readFileSync(`supabase/migrations/${name}`,'utf8')}))
  const hashes = sources.map(({name,sql}) => ({name,sha256:createHash('sha256').update(sql).digest('hex')}))
  const id = createHash('sha256').update(JSON.stringify(hashes)).digest('hex')
  const guard = `do $$ begin
    if to_regclass('public.service_groups') is not null or to_regclass('private.assignment_rollout') is not null then
      raise exception 'Prepare is only for an unconverted database';
    end if;
    if to_regprocedure('private.cleanup_team_participant_removal()') is null then
      raise exception 'Atomic participant cleanup prerequisite missing';
    end if;
  end $$;
  create table private.group_service_release_manifest(id text primary key, installed_at timestamptz default clock_timestamp());
  revoke all on private.group_service_release_manifest from public,anon,authenticated;
  insert into private.group_service_release_manifest(id) values('${id}');
  `
  const prepare = guard + sources.map(({name,sql})=>`\n-- ${name}\n${sql}`).join('\n')
    + "\nselect private.set_assignment_rollout_phase('compatibility','Prepare bundle: old clients retained; no strict adoption approval');\n"
  const match = `do $$ begin
    if not exists(select 1 from private.group_service_release_manifest where id='${id}') then
      raise exception 'Release manifest mismatch';
    end if;
    if length(btrim(coalesce(current_setting('app.rollout_evidence',true),'')))<20 then
      raise exception 'Set app.rollout_evidence to the reviewed device/audit/backup evidence';
    end if;
  end $$;\n`
  const strict = match + "select private.set_assignment_rollout_phase('strict',current_setting('app.rollout_evidence'));\n"
  const compatibility = match + "select private.set_assignment_rollout_phase('compatibility',current_setting('app.rollout_evidence'));\n"
  return {id,hashes,prepare,strict,compatibility}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Generation only: no credentials, database connection, apply mode or deploy.
  const bundle=buildGroupRolloutBundle(),dir='scratch/group-service-rollout'
  mkdirSync(dir,{recursive:true,mode:0o700})
  for(const [name,sql] of [['01-prepare',bundle.prepare],['03-strict',bundle.strict],['rollback-to-compatibility',bundle.compatibility]]) {
    writeFileSync(`${dir}/${name}.sql`,sql,{mode:0o600})
  }
  writeFileSync(`${dir}/manifest.json`,JSON.stringify({id:bundle.id,files:bundle.hashes},null,2),{mode:0o600})
  console.log(JSON.stringify({generated:dir,id:bundle.id,note:'Not applied. Each SQL file requires one transaction; never run individual embedded migrations.'}))
}
