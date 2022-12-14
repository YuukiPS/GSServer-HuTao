import AvatarData from '$/gameData/data/AvatarData'
import SkillData from '$/gameData/data/SkillData'
import { ElemTypeEnum, PlayerPropEnum } from '@/types/enum'
import SkillDepotUserData from '@/types/user/SkillDepotUserData'
import Avatar from '..'
import InherentProudSkill from './inherentProudSkill'
import Skill from './skill'
import Talent from './talent'

// TODO: Reimplement

export default class SkillDepot {
  avatar: Avatar
  id: number
  inherentProudSkills: InherentProudSkill[]
  skills: Skill[]
  energySkill?: Skill
  talents: Talent[]

  constructor(avatar: Avatar) {
    this.avatar = avatar

    this.inherentProudSkills = []
    this.skills = []
    this.talents = []
  }

  async init(userData: SkillDepotUserData) {
    await this.update()

    const { skills, talents, energySkill } = this
    const { skillDataList, energySkillData } = userData

    for (const skill of skills) {
      const skillData = skillDataList.find(data => data.id === skill.id)
      if (!skillData) continue

      await skill.init(skillData)
    }

    for (const talent of talents) await talent.init()

    if (!energySkill) return

    if (energySkillData) await energySkill.init(energySkillData)
    else await energySkill.initNew()
  }

  async initNew() {
    await this.update()

    const { skills, talents, energySkill } = this

    for (const skill of skills) await skill.initNew()
    for (const talent of talents) await talent.init()

    await energySkill?.initNew()
  }

  async update() {
    const { avatar, inherentProudSkills, skills, talents } = this
    const promoteLevel = avatar.props.get(PlayerPropEnum.PROP_BREAK_LEVEL)

    const avatarData = await AvatarData.getAvatar(avatar.avatarId)
    if (!avatarData) return

    const depotData = await SkillData.getSkillDepot(avatarData.SkillDepotId)
    if (!depotData) return

    this.id = depotData.Id

    // inherentProudSkills
    for (const proudSkillOpen of depotData.InherentProudSkillOpens) {
      if (proudSkillOpen.ProudSkillGroupId == null) continue
      if (proudSkillOpen.NeedAvatarPromoteLevel != null && promoteLevel < proudSkillOpen.NeedAvatarPromoteLevel) continue

      const proudSkillData = await SkillData.getProudSkillByGroup(proudSkillOpen.ProudSkillGroupId)
      if (proudSkillData == null) continue

      inherentProudSkills.push(new InherentProudSkill(this, proudSkillData.Id))
    }

    // skills
    skills.push(...depotData.Skills.filter(id => id !== 0).map(id => new Skill(this, id)))
    if (depotData.EnergySkill != null) this.energySkill = new Skill(this, depotData.EnergySkill)

    // talents
    talents.push(...depotData.Talents.map(id => new Talent(this, id)))
  }

  getCostElemVal(): number {
    return this.energySkill?.costElemVal || 0
  }

  getCostElemType(): ElemTypeEnum {
    return this.energySkill?.costElemType || ElemTypeEnum.NONE
  }

  exportSkillLevelMap() {
    const { skills, energySkill } = this
    return Object.fromEntries(
      skills.concat(energySkill).filter(skill => skill != null).map(skill => [skill.id, skill.level])
    )
  }

  exportProudSkillExtraLevelMap() {
    const { skills } = this
    return Object.fromEntries(
      skills
        .filter(skill => skill.proudSkill != null)
        .map(skill => [skill.proudSkill.groupId, skill.proudSkill.level])
    )
  }

  export() {
    const { id, inherentProudSkills, talents } = this

    return {
      skillDepotId: id,
      inherentProudSkillList: inherentProudSkills.map(s => s.id),
      skillLevelMap: this.exportSkillLevelMap(),
      proudSkillExtraLevelMap: this.exportProudSkillExtraLevelMap(),
      talentIdList: talents.map(talent => talent.id)
    }
  }

  exportUserData(): SkillDepotUserData {
    const { skills, energySkill } = this

    return {
      skillDataList: skills.map(skill => skill.exportUserData()),
      energySkillData: energySkill?.exportUserData() || false
    }
  }
}