import BaseClass from '#/baseClass'
import { PacketContext } from '#/packet'
import AbilityInvocations from '#/packets/AbilityInvocations'
import ClientAbilityChange from '#/packets/ClientAbilityChange'
import ClientAbilityInitFinish from '#/packets/ClientAbilityInitFinish'
import AbilityAction from '$/ability/abilityAction'
import abilityHash from '$/ability/abilityHash'
import AbilityScalarValueContainer from '$/ability/abilityScalarValueContainer'
import AppliedAbility from '$/ability/appliedAbility'
import AppliedModifier from '$/ability/appliedModifier'
import Embryo from '$/ability/embryo'
import Entity from '$/entity'
import AbilityData from '$/gameData/data/AbilityData'
import Logger from '@/logger'
import { AbilityActionCreateGadget, AbilityActionGenerateElemBall, AbilityEmbryo, AbilityInvokeEntry, AbilityInvokeEntryHead, AbilityMetaAddAbility, AbilityMetaLoseHp, AbilityMetaModifierChange, AbilityMetaModifierDurabilityChange, AbilityMetaReInitOverrideMap, AbilityMetaSetKilledState, AbilityScalarValueEntry, AbilityString, AbilitySyncStateInfo } from '@/types/proto'
import { AbilityInvokeArgumentEnum, ModifierActionEnum } from '@/types/proto/enum'
import { dataToProtobuffer } from '@/utils/proto'

const protoLookupTable = {
  ABILITY_NONE: '',
  ABILITY_META_MODIFIER_CHANGE: 'AbilityMetaModifierChange',
  ABILITY_META_COMMAND_MODIFIER_CHANGE_REQUEST: null,
  ABILITY_META_SPECIAL_FLOAT_ARGUMENT: 'AbilityMetaSpecialFloatArgument',
  ABILITY_META_OVERRIDE_PARAM: 'AbilityScalarValueEntry',
  ABILITY_META_CLEAR_OVERRIDE_PARAM: 'AbilityString',
  ABILITY_META_REINIT_OVERRIDEMAP: 'AbilityMetaReInitOverrideMap',
  ABILITY_META_GLOBAL_FLOAT_VALUE: 'AbilityScalarValueEntry',
  ABILITY_META_CLEAR_GLOBAL_FLOAT_VALUE: 'AbilityString',
  ABILITY_META_ABILITY_ELEMENT_STRENGTH: null,
  ABILITY_META_ADD_OR_GET_ABILITY_AND_TRIGGER: 'AbilityMetaAddOrGetAbilityAndTrigger',
  ABILITY_META_SET_KILLED_SETATE: 'AbilityMetaSetKilledState',
  ABILITY_META_SET_ABILITY_TRIGGER: 'AbilityMetaSetAbilityTrigger',
  ABILITY_META_ADD_NEW_ABILITY: 'AbilityMetaAddAbility',
  ABILITY_META_REMOVE_ABILITY: '',
  ABILITY_META_SET_MODIFIER_APPLY_ENTITY: 'AbilityMetaSetModifierApplyEntityId',
  ABILITY_META_MODIFIER_DURABILITY_CHANGE: 'AbilityMetaModifierDurabilityChange',
  ABILITY_META_ELEMENT_REACTION_VISUAL: 'AbilityMetaElementReactionVisual',
  ABILITY_META_SET_POSE_PARAMETER: 'AbilityMetaSetPoseParameter',
  ABILITY_META_UPDATE_BASE_REACTION_DAMAGE: 'AbilityMetaUpdateBaseReactionDamage',
  ABILITY_META_TRIGGER_ELEMENT_REACTION: 'AbilityMetaTriggerElementReaction',
  ABILITY_META_LOSE_HP: 'AbilityMetaLoseHp',
  ABILITY_ACTION_TRIGGER_ABILITY: 'AbilityActionTriggerAbility',
  ABILITY_ACTION_SET_CRASH_DAMAGE: 'AbilityActionSetCrashDamage',
  ABILITY_ACTION_EFFECT: null,
  ABILITY_ACTION_SUMMON: 'AbilityActionSummon',
  ABILITY_ACTION_BLINK: 'AbilityActionBlink',
  ABILITY_ACTION_CREATE_GADGET: 'AbilityActionCreateGadget',
  ABILITY_ACTION_APPLY_LEVEL_MODIFIER: null,
  ABILITY_ACTION_GENERATE_ELEM_BALL: 'AbilityActionGenerateElemBall',
  ABILITY_ACTION_SET_RANDOM_OVERRIDE_MAP_VALUE: 'AbilityActionSetRandomOverrideMapValue',
  ABILITY_ACTION_SERVER_MONSTER_LOG: 'AbilityActionServerMonsterLog',
  ABILITY_ACTION_CREATE_TILE: 'AbilityActionCreateTile',
  ABILITY_ACTION_DESTROY_TILE: 'AbilityActionDestroyTile',
  ABILITY_ACTION_FIRE_AFTER_IMAGE: 'AbilityActionFireAfterImgae',
  ABILITY_MIXIN_AVATAR_STEER_BY_CAMERA: 'AbilityMixinAvatarSteerByCamera',
  ABILITY_MIXIN_MONSTER_DEFEND: null,
  ABILITY_MIXIN_WIND_ZONE: 'AbilityMixinWindZone',
  ABILITY_MIXIN_COST_STAMINA: 'AbilityMixinCostStamina',
  ABILITY_MIXIN_ELITE_SHIELD: 'AbilityMixinEliteShield',
  ABILITY_MIXIN_ELEMENT_SHIELD: 'AbilityMixinElementShield',
  ABILITY_MIXIN_GLOBAL_SHIELD: 'AbilityMixinGlobalShield',
  ABILITY_MIXIN_SHIELD_BAR: 'AbilityMixinShieldBar',
  ABILITY_MIXIN_WIND_SEED_SPAWNER: 'AbilityMixinWindSeedSpawner',
  ABILITY_MIXIN_DO_ACTION_BY_ELEMENT_REACTION: 'AbilityMixinDoActionByElementReaction',
  ABILITY_MIXIN_FIELD_ENTITY_COUNT_CHANGE: 'AbilityMixinFieldEntityCountChange',
  ABILITY_MIXIN_SCENE_PROP_SYNC: 'AbilityMixinScenePropSync',
  ABILITY_MIXIN_WIDGET_MP_SUPPORT: 'AbilityMixinWidgetMpSupport'
}

const logger = new Logger('ABILIT', 0x10ff10)

export default class AbilityManager extends BaseClass {
  entity: Entity

  action: AbilityAction

  dynamicValueMapContainer: AbilityScalarValueContainer
  sgvDynamicValueMapContainer: AbilityScalarValueContainer

  embryoList: Embryo[]
  abilityList: AppliedAbility[]
  modifierList: AppliedModifier[]

  initialized: boolean

  constructor(entity: Entity) {
    super()

    this.entity = entity

    this.action = new AbilityAction(this)

    this.dynamicValueMapContainer = new AbilityScalarValueContainer()
    this.sgvDynamicValueMapContainer = new AbilityScalarValueContainer()

    this.embryoList = []
    this.abilityList = []
    this.modifierList = []

    this.initialized = false

    super.initHandlers(this)
  }

  private getNewId(): number {
    const { embryoList } = this

    let id = 0
    while (embryoList.find(e => e.id === id)) id++

    return id
  }

  private async parseEntry(entry: AbilityInvokeEntry): Promise<{ type: string, head: AbilityInvokeEntryHead, data: any, buf: Buffer }> {
    const { head, argumentType, abilityData } = entry
    const argType = AbilityInvokeArgumentEnum[argumentType]
    const buf = Buffer.from(abilityData, 'base64')
    const proto = protoLookupTable[argType]

    if (proto == null) {
      logger.warn('No proto for argument type:', argumentType, argType, buf.toString('base64'))
      return null
    }

    return {
      type: argType.replace(/(?<=(^|_)[A-Z]).*?(?=($|_))/g, v => v.toLowerCase()).replace(/_/g, ''),
      head,
      data: await dataToProtobuffer(buf, proto),
      buf
    }
  }

  addEmbryo(name: string = 'Default', overrideName: string = 'Default') {
    const id = this.getNewId()

    this.embryoList.push(new Embryo(this, id, name, overrideName))

    logger.verbose('Register:', id, '->', `${name}[${overrideName}]`)
  }

  removeEmbryo(embryo: Embryo) {
    const { embryoList } = this
    const { manager, id, name, overrideName } = embryo
    if (manager !== this) return

    embryoList.splice(embryoList.indexOf(embryo), 1)

    logger.verbose('Unregister:', id, '->', `${name}[${overrideName}]`)
  }

  clearEmbryo() {
    const { embryoList } = this
    for (const embryo of embryoList) this.removeEmbryo(embryo)
  }

  getEmbryo(id: number): Embryo {
    return this.embryoList.find(embryo => embryo.id === id) || null
  }

  applyAbility(id: number): AppliedAbility {
    let ability = this.getAbility(id)
    if (ability) return ability

    ability = new AppliedAbility(this, id)
    this.abilityList.push(ability)

    return ability
  }

  removeAbility(id: number) {
    const { abilityList } = this
    const ability = this.getAbility(id)
    if (ability == null) return

    abilityList.splice(abilityList.indexOf(ability), 1)
  }

  clearAbility() {
    const { abilityList } = this
    for (const ability of abilityList) this.removeAbility(ability.id)
  }

  getAbility(id: number): AppliedAbility {
    return this.abilityList.find(a => a.id === id) || null
  }

  getAbilityByName(name: AbilityString): AppliedAbility {
    return this.abilityList.find(a => a.abilityName.hash === name.hash || (name.str && a.abilityName.str === name.str)) || null
  }

  applyModifier(id: number): AppliedModifier {
    let modifier = this.getModifier(id)
    if (modifier) return modifier

    modifier = new AppliedModifier(this, id)
    this.modifierList.push(modifier)

    return modifier
  }

  removeModifier(id: number) {
    const { modifierList } = this
    const modifier = this.getModifier(id)
    if (modifier == null) return

    modifierList.splice(modifierList.indexOf(modifier), 1)
  }

  clearModifier() {
    const { modifierList } = this
    for (const modifier of modifierList) this.removeModifier(modifier.id)
  }

  getModifier(id: number): AppliedModifier {
    return this.modifierList.find(modifier => modifier.id === id) || null
  }

  initFromEmbryos() {
    const { embryoList, abilityList } = this
    for (const embryo of embryoList) {
      const { name, overrideName } = embryo
      const usedIdList = abilityList.map(a => a.id)

      let id = 1
      while (usedIdList.includes(id)) id++

      const ability = this.applyAbility(id)

      ability.setAbilityName({ hash: abilityHash(name) })
      ability.setAbilityOverride({ hash: abilityHash(overrideName) })
    }
  }

  exportAbilitySyncStateInfo(): AbilitySyncStateInfo {
    const { dynamicValueMapContainer, sgvDynamicValueMapContainer, abilityList, modifierList, initialized } = this
    if (!initialized) return {}

    return {
      isInited: true,
      dynamicValueMap: dynamicValueMapContainer.export(),
      appliedAbilities: abilityList.map(ability => ability.export()),
      appliedModifiers: modifierList.map(modifier => modifier.export()),
      sgvDynamicValueMap: sgvDynamicValueMapContainer.export()
    }
  }

  exportEmbryoList(): AbilityEmbryo[] {
    return this.embryoList.map(embryo => embryo.export())
  }

  /**Events**/

  // AbilityInvoke
  async handleAbilityInvoke(context: PacketContext, entry: AbilityInvokeEntry) {
    const { player, seqId } = context

    player?.forwardBuffer?.addEntry(AbilityInvocations, entry, seqId)

    const parsed = await this.parseEntry(entry)
    if (parsed == null) return
    const { type, head, data, buf } = parsed

    logger.verbose(type)

    await this.emit(type, context, head, data, buf)
  }

  // ClientAbilityChange
  async handleClientAbilityChange(context: PacketContext, entry: AbilityInvokeEntry) {
    const { player, seqId } = context

    player?.forwardBuffer?.addEntry(ClientAbilityChange, entry, seqId)

    const parsed = await this.parseEntry(entry)
    if (parsed == null) return
    const { type, head, data, buf } = parsed

    await this.emit(type, context, head, data, buf)
  }

  // ClientAbilityInitFinish
  async handleClientAbilityInitFinish(context: PacketContext, entry: AbilityInvokeEntry) {
    const { player, seqId } = context

    player?.forwardBuffer?.addEntry(ClientAbilityInitFinish, entry, seqId)

    this.initialized = true

    const parsed = await this.parseEntry(entry)
    if (parsed == null) return
    const { type, head, data, buf } = parsed

    await this.emit(type, context, head, data, buf)
  }

  /**Ability Events**/

  // AbilityNone
  async handleAbilityNone(context: PacketContext, head: AbilityInvokeEntryHead) {
    const { entity, action } = this
    const { manager: entityManager } = entity
    const { instancedAbilityId, localId, targetId } = head
    const ability = this.getAbility(instancedAbilityId)
    if (ability == null) return logger.debug(entity.entityId, 'AbilityNone', 'NoAbility', head)

    const actionConfig = await AbilityData.getActionByLocalId(AbilityData.lookupString(ability.abilityName), localId)
    if (actionConfig == null) return logger.debug(entity.entityId, 'AbilityNone', 'NoAction', head, ability?.abilityName)

    await action.runActionConfig(context, ability, actionConfig, entityManager.getEntity(targetId))
  }

  // AbilityMetaAddNewAbility
  async handleAbilityMetaAddNewAbility(_context: PacketContext, _head: AbilityInvokeEntryHead, data: AbilityMetaAddAbility) {
    const { instancedAbilityId, abilityName, abilityOverride, overrideMap } = data?.ability || {}
    if (instancedAbilityId == null) return

    const ability = this.applyAbility(instancedAbilityId)

    ability.setAbilityName(abilityName)
    ability.setAbilityOverride(abilityOverride)
    ability.setOverrideMap(overrideMap)
  }

  // AbilityMetaRemoveAbility
  async handleAbilityMetaRemoveAbility(_context: PacketContext, head: AbilityInvokeEntryHead) {
    const { instancedAbilityId } = head
    if (instancedAbilityId == null) return

    this.removeAbility(instancedAbilityId)
  }

  // AbilityMetaGlobalFloatValue
  async handleAbilityMetaGlobalFloatValue(_context: PacketContext, _head: AbilityInvokeEntryHead, data: AbilityScalarValueEntry) {
    this.dynamicValueMapContainer.setValue(data)
  }

  // AbilityMetaReinitOverridemap
  async handleAbilityMetaReinitOverridemap(_context: PacketContext, head: AbilityInvokeEntryHead, data: AbilityMetaReInitOverrideMap) {
    const { instancedAbilityId } = head
    const { overrideMap } = data
    const ability = this.getAbility(instancedAbilityId)
    if (ability == null) return

    ability.setOverrideMap(overrideMap)
  }

  // AbilityMetaOverrideParam
  async handleAbilityMetaOverrideParam(_context: PacketContext, head: AbilityInvokeEntryHead, data: AbilityScalarValueEntry) {
    const { instancedAbilityId } = head
    const ability = this.getAbility(instancedAbilityId)
    if (ability == null) return

    ability.setOverrideParam(data)
  }

  // AbilityMetaModifierChange
  async handleAbilityMetaModifierChange(context: PacketContext, head: AbilityInvokeEntryHead, data: AbilityMetaModifierChange) {
    const { entity } = this
    const { instancedAbilityId, instancedModifierId, modifierConfigLocalId } = head
    const { action, parentAbilityName, parentAbilityOverride, isAttachedParentAbility, applyEntityId } = data

    switch (action || ModifierActionEnum.ADDED) {
      case ModifierActionEnum.ADDED: {
        const modifier = this.applyModifier(instancedModifierId)

        modifier.setAbilityId(instancedAbilityId)
        modifier.setParentAbility(parentAbilityName, parentAbilityOverride)
        modifier.setLocalId(modifierConfigLocalId)
        modifier.setAttachedParent(isAttachedParentAbility)
        modifier.setApplyEntityId(applyEntityId)

        await modifier.emit('Added', context)
        break
      }
      case ModifierActionEnum.REMOVED: {
        const modifier = this.getModifier(instancedModifierId)
        if (modifier == null) return

        await modifier.emit('Removed', context)

        this.removeModifier(instancedModifierId)
        break
      }
      default:
        logger.warn(entity.entityId, 'MetaModifierChange', 'Unknown action:', action)
    }
  }

  // AbilityMetaModifierDurabilityChange
  async handleAbilityMetaModifierDurabilityChange(_context: PacketContext, head: AbilityInvokeEntryHead, data: AbilityMetaModifierDurabilityChange) {
    const { instancedModifierId } = head
    const { reduceDurability, remainDurability } = data
    const modifier = this.getModifier(instancedModifierId)
    if (modifier == null) return

    modifier.setDurability(reduceDurability, remainDurability)
  }

  // AbilityMetaLoseHp
  async handleAbilityMetaLoseHp(_context: PacketContext, head: AbilityInvokeEntryHead, data: AbilityMetaLoseHp, buf: Buffer) {
    const { entity } = this
    const { instancedAbilityId } = head
    const ability = this.getAbility(instancedAbilityId)

    logger.debug(entity.entityId, 'MetaLoseHp', ability?.abilityName, head, data, buf)
  }

  // AbilityMetaSetKilledState
  async handleAbilityMetaSetKilledState(_context: PacketContext, head: AbilityInvokeEntryHead, data: AbilityMetaSetKilledState, buf: Buffer) {
    const { entity } = this
    const { instancedAbilityId } = head
    const ability = this.getAbility(instancedAbilityId)

    logger.debug(entity.entityId, 'MetaSetKilledState', ability?.abilityName, head, data, buf)
  }

  // AbilityActionCreateGadget
  async handleAbilityActionCreateGadget(_context: PacketContext, head: AbilityInvokeEntryHead, data: AbilityActionCreateGadget, buf: Buffer) {
    const { entity } = this
    const { instancedAbilityId } = head
    const ability = this.getAbility(instancedAbilityId)

    logger.debug(entity.entityId, 'ActionCreateGadget', ability?.abilityName, head, data, buf.toString('base64'))
  }

  // AbilityActionGenerateElemBall
  async handleAbilityActionGenerateElemBall(_context: PacketContext, head: AbilityInvokeEntryHead, data: AbilityActionGenerateElemBall, buf: Buffer) {
    const { entity } = this
    const { instancedAbilityId } = head
    const ability = this.getAbility(instancedAbilityId)

    logger.debug(entity.entityId, 'ActionGenerateElemBall', ability?.abilityName, head, data, buf.toString('base64'))
  }
}