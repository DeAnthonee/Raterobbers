package com.deanthonee.eyespy.minigame.diceroll

import kotlin.random.Random

class DiceRollerImpl : DiceRoller {
    override fun rollDice(numberOfDice: Int):List<Int> {

        val mutableList = ArrayList<Int>()

        for ( i in 0..numberOfDice){
            val number = Random.nextInt(1,6)
            mutableList.add(number)
        }

        return mutableList
    }
}