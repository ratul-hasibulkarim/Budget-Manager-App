import { useState } from 'react';
import { Linking, Share, Switch, View } from 'react-native';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { isAdmin, isSettled, netBalances, newInviteCode, summarize, type Member, type OpPayloads, type OpType } from '@bm/core';
import { Banner, Button, Card, Row, Screen, Section, Txt } from '../components/ui';
import { SyncBanner } from '../components/SyncBanner';
import { useSettings } from '../lib/settings';
import { useProject, useWorkspace } from '../lib/workspace';
import { ask, errorText, money, personName } from '../lib/format';
import { ReadOnlyBanner, RejectedList } from './Dashboard';

export function Members({ projectId }: { projectId: string }) {
  const { t, theme, settings } = useSettings();
  const ws = useWorkspace();
  const { state } = useProject(projectId);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  if (!state) return null;
  const me = ws.userId;
  const admin = isAdmin(state, me);
  const writable = state.status === 'active';
  const lang = settings.lang;
  const net = netBalances(state);
  const contributions = summarize(state, me).contributions;
  const name = (id: string) => personName(state, id, me, t);
  const all = Object.values(state.members);
  const pending = all.filter((m) => m.status === 'pending');
  const active = all.filter((m) => m.status === 'active').sort((a, b) => a.joinIndex! - b.joinIndex!);
  const former = all.filter((m) => (m.status === 'left' || m.status === 'removed') && m.joinIndex !== null);
  const mine = state.members[me];

  async function run<T extends OpType>(type: T, payload: OpPayloads[T]) {
    try {
      setError(null);
      await ws.submit(projectId, type, payload);
    } catch (e) {
      setError(errorText(e, t));
    }
  }

  const inviteText = state.inviteCode ? t('inviteMessage', { name: state.name, code: state.inviteCode }) : '';

  return (
    <Screen>
      <SyncBanner />
      <ReadOnlyBanner state={state} />
      <RejectedList projectId={projectId} />
      {error ? <Banner testID="members-error" kind="error" text={error} /> : null}

      {state.links.whatsapp || state.links.telegram ? (
        <Section title={t('chatLinks')}>
          <Card>
            {state.links.whatsapp ? <Button testID="open-whatsapp" kind="secondary" label={t('joinWhatsapp')} onPress={() => void Linking.openURL(state.links.whatsapp!)} /> : null}
            {state.links.telegram ? <Button testID="open-telegram" kind="secondary" label={t('joinTelegram')} onPress={() => void Linking.openURL(state.links.telegram!)} /> : null}
          </Card>
        </Section>
      ) : null}

      {admin && writable ? (
        <Section title={t('invite')}>
          <Card testID="invite-card">
            {state.inviteCode ? (
              <>
                <Txt testID="invite-code-value" weight="bold" size={26} style={{ letterSpacing: 3 }}>
                  {state.inviteCode}
                </Txt>
                <Row wrap>
                  <Button small label={copied ? t('copied') : t('copy')} onPress={() => void Clipboard.setStringAsync(state.inviteCode!).then(() => setCopied(true))} />
                  <Button small kind="secondary" label={t('shareInvite')} onPress={() => void Share.share({ message: inviteText })} />
                  <Button small kind="secondary" label="WhatsApp" onPress={() => void Linking.openURL(`https://wa.me/?text=${encodeURIComponent(inviteText)}`)} />
                  <Button testID="new-invite-code" small kind="ghost" label={t('newCode')} onPress={() => void run('project.setInviteCode', { code: newInviteCode() })} />
                  <Button small kind="ghost" label={t('turnOffInvite')} onPress={() => void run('project.setInviteCode', { code: null })} />
                </Row>
              </>
            ) : (
              <>
                <Txt muted>{t('noInvite')}</Txt>
                <Button testID="create-invite" small label={t('newCode')} onPress={() => void run('project.setInviteCode', { code: newInviteCode() })} />
              </>
            )}
          </Card>
        </Section>
      ) : null}

      {admin && pending.length ? (
        <Section title={t('pendingRequests')}>
          {pending.map((m) => (
            <Card key={m.userId} testID={`pending-${m.profile.name ?? m.userId}`}>
              <Txt weight="semibold">{name(m.userId)}</Txt>
              {writable ? (
                <Row>
                  <Button testID="approve-member" small label={t('approve')} onPress={() => void run('member.approve', { userId: m.userId })} />
                  <Button small kind="secondary" label={t('reject')} onPress={() => void run('member.reject', { userId: m.userId })} />
                </Row>
              ) : null}
            </Card>
          ))}
        </Section>
      ) : null}

      <Section title={t('members')}>
        {active.map((m) => (
          <MemberCard
            key={m.userId}
            m={m}
            label={name(m.userId)}
            net={net[m.userId] ?? 0}
            contribution={contributions[m.userId] ?? 0}
            isCreator={m.userId === state.createdBy}
            canManage={admin && writable && m.userId !== me}
            run={run}
            cur={state.currency}
          />
        ))}
      </Section>

      {mine?.status === 'active' && writable ? (
        <Card>
          <Button testID="edit-profile" kind="secondary" label={t('editProfile')} onPress={() => router.push(`/project/${projectId}/profile`)} />
          {mine.leaveRequested ? (
            <>
              <Txt muted>{t('leaveRequested')}</Txt>
              <Button small kind="ghost" label={t('cancelRequest')} onPress={() => void run('member.cancelLeaveRequest', {})} />
            </>
          ) : isSettled(state, me) ? (
            <Button
              testID="leave-project"
              kind="danger"
              label={t('leaveProject')}
              onPress={async () => {
                if (await ask(`${t('leaveProject')}?`, t('leaveProject'), t('cancel'))) await run('member.leave', {});
              }}
            />
          ) : (
            <Button testID="request-leave" kind="secondary" label={t('requestLeave')} onPress={() => void run('member.requestLeave', {})} />
          )}
        </Card>
      ) : null}

      {former.length ? (
        <Section title={`${t('left')} / ${t('removed')}`}>
          {former.map((m) => (
            <Card key={m.userId}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Txt muted>
                  {name(m.userId)} · {m.status === 'left' ? t('left') : t('removed')}
                </Txt>
                <Txt size={13} color={(net[m.userId] ?? 0) < 0 ? theme.negative : theme.textMuted}>
                  {money(net[m.userId] ?? 0, lang, state.currency, true)}
                </Txt>
              </Row>
            </Card>
          ))}
        </Section>
      ) : null}
    </Screen>
  );
}

function MemberCard({
  m,
  label,
  net,
  contribution,
  isCreator,
  canManage,
  run,
  cur,
}: {
  cur: string;
  m: Member;
  label: string;
  net: number;
  contribution: number;
  isCreator: boolean;
  canManage: boolean;
  run: <T extends OpType>(type: T, payload: OpPayloads[T]) => Promise<void>;
}) {
  const { t, theme, settings } = useSettings();
  return (
    <Card testID={`member-${m.profile.name ?? m.userId}`}>
      <Row style={{ justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          <Txt weight="semibold">{label}</Txt>
          <Txt size={12} muted>
            {[m.role === 'admin' ? t('admin') : t('member'), isCreator ? t('creator') : null, m.leaveRequested ? t('leaveRequested') : null].filter(Boolean).join(' · ')}
          </Txt>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Txt weight="semibold" color={net > 0 ? theme.positive : net < 0 ? theme.negative : theme.textMuted}>
            {money(net, settings.lang, cur, true)}
          </Txt>
          {contribution ? (
            <Txt size={12} muted>
              {t('contribution')}: {money(contribution, settings.lang, cur)}
            </Txt>
          ) : null}
        </View>
      </Row>
      {m.profile.bkash || m.profile.whatsapp ? (
        <Txt size={12} muted>
          {[m.profile.bkash ? `${t('bkash')}: ${m.profile.bkash}` : null, m.profile.whatsapp ? `${t('whatsapp')}: ${m.profile.whatsapp}` : null].filter(Boolean).join(' · ')}
        </Txt>
      ) : null}
      {m.profile.nid ? (
        <Txt size={12} muted>
          {t('nid')}: {m.profile.nid}
        </Txt>
      ) : null}
      {canManage ? (
        <>
          {m.role !== 'admin' ? (
            <Row style={{ justifyContent: 'space-between' }}>
              <Txt size={13}>{t('canAddExpenses')}</Txt>
              <Switch
                testID={`perm-${m.profile.name ?? m.userId}`}
                value={m.canAddExpenses}
                onValueChange={(v) => void run('member.setPermission', { userId: m.userId, canAddExpenses: v })}
              />
            </Row>
          ) : null}
          <Row wrap>
            <Button
              small
              kind="secondary"
              testID={`role-${m.profile.name ?? m.userId}`}
              label={m.role === 'admin' ? t('removeAdmin') : t('makeAdmin')}
              onPress={() => void run('member.setRole', { userId: m.userId, role: m.role === 'admin' ? 'member' : 'admin' })}
            />
            {m.leaveRequested ? (
              <>
                <Button small label={t('allowLeave')} onPress={() => void run('member.approveLeave', { userId: m.userId })} />
                <Button small kind="ghost" label={t('deny')} onPress={() => void run('member.denyLeave', { userId: m.userId })} />
              </>
            ) : null}
            {!isCreator ? (
              <Button
                small
                kind="ghost"
                label={t('remove')}
                onPress={async () => {
                  if (await ask(`${t('remove')} ${label}?`, t('remove'), t('cancel'))) await run('member.remove', { userId: m.userId });
                }}
              />
            ) : null}
          </Row>
        </>
      ) : null}
    </Card>
  );
}
