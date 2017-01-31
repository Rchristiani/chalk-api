'use strict'

const tests = {};
const models = require('./models');
const testRunner = require('./testRunner.js');

tests.createTest = (req,res) => {
	const model = req.body.data;
	const course = req.body.courseId;
	if(course === undefined) {
		res.status(400)
			.send({
				error: 'Missing courseId param.'
			});
			return;
	}
	model.created_at = +new Date();
	model.created_by = req.decodedUser.user_id;
	new models.test(model)
		.save((err,doc) => {
			if(err) {
				res.status(400)
					.send({
						error: err
					});
				return;
			}
			//Add test id to course
			addTestToCourse(doc._id,course)
				.then((courseDoc) => {
					doc.course = course;
					doc.save((err,doc) => {
						if(err) {
							res.status(400)
								.send({
									error: err
								});
							return;
						}
						res.status(200)
							.send({
								test: doc
							});
					})
				});
		});
};

tests.getTests = (req,res) => {
	models.test.find({},(err,docs) => {
		if(err){
			res.status(400)
				.send({
					error: err
				});
			return;
		}
		res.status(200)
			.send({
				tests: docs
			});
	});
};

tests.getSingleTest = (req,res) => {
	const id = req.params.id;
	models.test.findOne({_id: id},(err,doc) => {
		if(err) {
			res.status(400)
				.send({
					error: err
				});
			return;
		}
		res.status(200)
			.send({
				test: doc
			});
	}).populate('questions');
};

tests.addQuestion = (req,res) => {
	const testId = req.params.id;
	const questionId = req.body.questionId;
	models.test.findOneAndUpdate({_id:testId},{
		$push: {questions: questionId}
	},{
		new: true
	},
	(err,doc) => {
		if(err) {
			res.status(400)
				.send({
					error: err
				});
			return;
		}
		addTestToQuestion(testId,questionId)
			.then(() => {
				models.test.populate(doc,{path: 'questions'},
					(err, testWithQuestions) => {
						if(err) {
							res.status(400)
								.send({
									error: err
								});
							return;
						}
						res.status(200)
							.send({
								test: testWithQuestions
							});
					});
			})
			.catch((err) =>{
				res.status(400)
					.send({
						error: err
					});
			});
	})
};

tests.updateTest = (req,res) => {
	const id = req.params.id;
	const model = req.body;
	models.test.findOne({_id:id}, (err,doc) => {
		if(err) {
			res.status(400)
				.send({
					error: err
				});
			return;
		}
		if(model._id) {
			delete model._id;
		}
		Object.assign(doc,model);
		doc.save((err,saveDoc) => {
			if(err) {
				res.status(400)
					.send({
						error: err
					});
				return
			}
			res.status(200)
				.send({
					test: doc
				});
		});
	});
};

tests.addUser = (req,res) => {
	const testId = req.params.id;
	const userId = req.body.userId;
	models.test.findOneAndUpdate({_id: testId},{
		$addToSet: {users:userId}
	}, {
		new: true
	},(err,doc) => {
		if(err) {
			res.status(400)
				.send({
					error: err
				});
			return;
		}
		addTestToUser(testId,userId)
			.then((user) => {
				res.status(200)
					.send({
						test: doc
					});
			})
			.catch((err) => {
				res.status(400)
					.send({
						error: err
					});
			});
	});
};

function fold(array) {
	return array[0];
}

function findAnswerWithId(id, answers) {
	return answers.filter(answer => answer.questionId === id)
}

tests.evaluate = (req,res) => {
	const testId = req.params.id;
	const userId = req.body.userId;
	const answers = req.body.answers;
	//Check if user is part of test
	models.test.findOne({_id:testId},(err,doc) => {
		if(err) {
			res.status(400)
				.send({
					error: error
				});
			return;
		}
		if(doc.users.includes(userId)) {
			//start going through the questions
			//compare against their answer
			//If code test, run unit test
			//else check multiple choice
			//Add results to user object
			const userAnswers = doc.questions.map((question,i) => {
				const answer = fold(findAnswerWithId(question._id.toString(),answers));
				if(question.type === 'multiple choice') {
					return new Promise((resolve,reject) => {
						resolve({
							id: question._id,
							type: 'multiple choice',
							expected: question.multiAnswer,
							actual: answer.answer,
							correct: (_ => {
								return question.multiAnswer === answer.answer
							})()
						})
					});
				}
				else {
					return new Promise((resolve,reject) => {
						testRunner
							.run(question,answer.answer)
							.then(res => resolve({
								id: question._id,
								type: 'Code',
								actual: answer.answer,
								correct: JSON.parse(res)
							}))
							.catch(reject);
					});
				}
			});

			Promise.all(userAnswers)
				.then(answers => {
					models.user.findOne({_id: userId},{password: 0},(err,userDoc) => {
						if(err) {
							res.status(400)
								.send({
									error: err
								});
							return;
						}
						//search test_results key,
						//if test exists do nothing
						//else add test and results
						if(doesTestExist(testId,userDoc.test_results)) {
							res.status(400)
								.send({
									error: "User has already taken test"
								});
							return;
						}
						if(!userDoc.test_results) {
							userDoc.test_results = [];
						}
						userDoc.test_results.push({
							id: testId,
							answers
						});
						userDoc.save((err,newUserDoc) => {
							if(err) {
								res.status(400)
									.send({
										error: err
									});
								return;
							}
							res.status(200)
								.send({
									user: newUserDoc
								});
						});
					});
				})
				.catch((err) => {
					res.status(400)
						.send({
							error: (() => {
								return err || 'Something bad happened...although I don\'t know what.' 
							})()
						});
				});
		}
		else {
			res.status(401)
				.send({
					error: err
				});
		}

	}).populate('questions');
};

tests.removeQuestionFromTest = (req,res) => {
	const testId = req.params.id;
	const questionId = req.body.questionId;
	models.test.findOneAndUpdate({_id: testId}, {
		$pull: {questions: questionId}
	}, 
	{
		new: true
	},
	(err,doc) => {
		if(err) {
			res.status(400)
				.send({
					error: err
				});
			return;
		}
		removeTestFromQuestion(testId,questionId)
			.then(() => {
				models.test.populate(doc,{path: 'questions'},
					(err, testWithQuestions) => {
						if(err) {
							res.status(400)
								.send({
									error: err
								});
							return
						}
						res.status(200)
							.send({
								test: testWithQuestions
							});
					});
			})
			.catch((err) =>{
				res.status(400)
					.send({
						error: err
					});
			});
	});
};

tests.removeTest = (req,res) => {
	const id = req.params.id;
	models.test.findOneAndRemove({_id: id},(err,doc) => {
		if(err) {
			res.status(400)
				.send({
					error: err
				});
			return;
		}
		const questionsToCleanUp = doc.questions.map((question) => removeTestFromQuestion(id,question))
		Promise.all([removeTestFromCourse(id,doc.course),...questionsToCleanUp])
			.then(() => {
				res.status(200)
					.send({
						success: true
					});
			})
			.catch((err) => {
				res.status(400)
					.send({
						error: err
					});
			});
	});
};

function addTestToCourse(testId,courseId) {
	return new Promise((resolve,reject) => {
		models.course.findOneAndUpdate({_id:courseId}, {
			$push: {tests: testId}
		},(err,doc) => {
			if(err) {
				reject(err)
			}
			resolve(doc);
		});
	});
}

function removeTestFromCourse(testId,courseId) {
	return new Promise((resolve,reject) => {
		models.course.findOneAndUpdate({_id: courseId},{
			$pull: {tests: testId}
		},
		{
			new: true
		}, (err,doc) => {
			if(err) {
				reject(err);
			}
			resolve(doc);
		});
	});
}

function addTestToUser(testId,userId) {
	return new Promise((resolve,reject) => {
		models.user.findOneAndUpdate({
			_id: userId
		},{
			$addToSet: {tests: testId}
		},{
			new: true
		}, (err,doc) => {
			if(err) {
				reject(err);
			}
			resolve(doc);
		});
	});
}

function addTestToQuestion(testId,questionId) {
	return new Promise((resolve,reject) => {
		//Add testid to question
		models.question.findOneAndUpdate({_id: questionId}, {
			$addToSet: {tests: testId}
		},(err,doc) =>{
			if(err) {
				reject(err);
			}
			resolve(doc);
		});
	});
}

function removeTestFromQuestion(testId,questionId) {
	return new Promise((resolve,reject) => {
		//Remove testId from question
		models.question.findOneAndUpdate({_id: questionId}, {
			$pull: {tests: testId}
		}, (err,doc) => {
			if(err) {
				reject(err);
			}
			resolve(doc);
		});
	});
}


function doesTestExist(testId,userResults) {
	if(userResults === undefined) {
		return false;
	}
	for(let result of userResults) {
		if(result.id === testId) {
			return true;
		}
	}
	return false;
}


module.exports = tests;